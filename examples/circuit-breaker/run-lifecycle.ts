import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { updateCalibration } from "./calibration.ts";
import { analyzeCostAndUpdateBaseline, type CostClassification } from "./cost-baseline.ts";
import { detectToolLoop } from "./detector.ts";
import { getSessionEventLogPath, writeSessionEvents } from "./evidence-writer.ts";
import { openGitHubPrForPatch, type GitHubPrResult } from "./github-pr-writer.ts";
import {
	createCostAnomalyIntervention,
	createToolLoopIntervention,
	type CircuitBreakerIntervention,
	writeInterventionRecord,
} from "./intervention-writer.ts";
import type { CircuitBreakerEvent } from "./message-adapter.ts";
import { hydratePatchPlanWithContent, planPatchForIntervention } from "./patch-planner.ts";
import { resolveRunIdentity } from "./run-identity.ts";
import { verifyCircuitBreakerArtifacts } from "./verify-artifacts.ts";

export interface CircuitBreakerExecutionOptions {
	sessionId: string;
	events: CircuitBreakerEvent[];
	agentDir?: string;
	agentName?: string;
	rulesHash?: string;
	dryRun?: boolean;
	openPr?: boolean;
	githubRepository?: string;
	githubToken?: string;
	baseBranch?: string;
	branchName?: string;
	fetchImpl?: typeof fetch;
	rootDir?: string;
	updateBaseline?: boolean;
}

export interface CircuitBreakerRunSummary {
	sessionId: string;
	sessionEventLog: string;
	normalizedEventCount: number;
	interventionPath?: string;
	patchPath?: string;
	prBodyPath?: string;
	findingCount: number;
	costClassification?: CostClassification;
	costBaselinePath?: string;
	costQuarantinePath?: string;
	githubPr?: GitHubPrResult;
	calibrationPath?: string;
}

export async function executeCircuitBreakerRun(
	options: CircuitBreakerExecutionOptions,
): Promise<CircuitBreakerRunSummary> {
	if (options.openPr && options.dryRun) {
		throw new Error("--open-pr cannot be combined with --dry-run");
	}

	const rootDir = options.rootDir ?? process.cwd();
	const evidence = await writeSessionEvents({ rootDir, sessionId: options.sessionId, events: options.events });
	const relativeSessionLog = `memory/circuit-breaker/sessions/${options.sessionId}.jsonl`;
	const identity = await resolveRunIdentity(options);
	const costAnalysis = await analyzeCostIfPresent(rootDir, options.events, identity, options.updateBaseline);

	const finding = detectToolLoop(evidence.events);
	if (!finding) {
		if (costAnalysis?.classification.type === "cost_anomaly") {
			const intervention = createCostAnomalyIntervention({
				sessionId: options.sessionId,
				sessionEventLog: relativeSessionLog,
				classification: costAnalysis.classification,
				agent: identity.agentName,
				model: identity.model,
				rulesHash: identity.rulesHash,
			});
			const written = await writeInterventionArtifacts({ options, rootDir, intervention });
			return {
				sessionId: options.sessionId,
				sessionEventLog: evidence.path,
				normalizedEventCount: evidence.events.length,
				...written,
				findingCount: 1,
				costClassification: costAnalysis.classification,
				costBaselinePath: costAnalysis.path,
				costQuarantinePath: costAnalysis.quarantinedAnomalyPath,
			};
		}

		if (options.openPr) {
			throw new Error("--open-pr requires a detected intervention; no tool loop or cost anomaly was found");
		}

		const calibration = await updateCalibration(rootDir);
		return {
			sessionId: options.sessionId,
			sessionEventLog: getSessionEventLogPath(options.sessionId, rootDir),
			normalizedEventCount: evidence.events.length,
			findingCount: 0,
			costClassification: costAnalysis?.classification,
			costBaselinePath: costAnalysis?.path,
			costQuarantinePath: costAnalysis?.quarantinedAnomalyPath,
			calibrationPath: calibration.path,
		};
	}

	const intervention = createToolLoopIntervention({
		sessionId: options.sessionId,
		sessionEventLog: relativeSessionLog,
		finding,
		agent: identity.agentName,
		model: identity.model,
		rulesHash: identity.rulesHash,
		status: "dry_run",
	});
	const written = await writeInterventionArtifacts({ options, rootDir, intervention });

	return {
		sessionId: options.sessionId,
		sessionEventLog: evidence.path,
		normalizedEventCount: evidence.events.length,
		...written,
		findingCount: 1,
		costClassification: costAnalysis?.classification,
		costBaselinePath: costAnalysis?.path,
		costQuarantinePath: costAnalysis?.quarantinedAnomalyPath,
	};
}

async function writeInterventionArtifacts(input: {
	options: CircuitBreakerExecutionOptions;
	rootDir: string;
	intervention: CircuitBreakerIntervention;
}): Promise<Pick<
	CircuitBreakerRunSummary,
	"interventionPath" | "patchPath" | "prBodyPath" | "githubPr" | "calibrationPath"
>> {
	const { options, rootDir, intervention } = input;
	const written = await writeInterventionRecord({ rootDir, intervention });
	const patchPlan = await planPatchForCurrentTarget({ options, rootDir, intervention });
	const patchPath = `${written.path}.patch.diff`;
	const prBodyPath = `${written.path}.pr.md`;
	await writeFile(patchPath, patchPlan.patch, "utf8");
	await writeFile(prBodyPath, patchPlan.prBody, "utf8");
	let githubPr: GitHubPrResult | undefined;

	if (options.openPr) {
		await verifyCircuitBreakerArtifacts({
			rootDir,
			sessionId: intervention.session_id,
			expectInterventions: 1,
			requirePatch: true,
			requirePrBody: true,
		});
		githubPr = await openGitHubPrForPatch({
			token: options.githubToken ?? process.env.GITHUB_TOKEN ?? "",
			repository: options.githubRepository ?? process.env.TARGET_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "",
			intervention,
			patchPlan,
			baseBranch: options.baseBranch,
			branchName: options.branchName,
			fetchImpl: options.fetchImpl,
			artifactRootDir: rootDir,
		});
		await writeFile(patchPath, githubPr.patch, "utf8");
		await writeFile(prBodyPath, githubPr.prBody, "utf8");
		const openedIntervention = {
			...intervention,
			action: {
				...intervention.action,
				status: "opened_pr" as const,
				pr_url: githubPr.url,
			},
		};
		await writeInterventionRecord({ rootDir, intervention: openedIntervention, overwrite: true });
	}
	const calibration = await updateCalibration(rootDir);

	return {
		interventionPath: written.path,
		patchPath,
		prBodyPath,
		githubPr,
		calibrationPath: calibration.path,
	};
}

async function planPatchForCurrentTarget(input: {
	options: CircuitBreakerExecutionOptions;
	rootDir: string;
	intervention: CircuitBreakerIntervention;
}) {
	const patchPlan = planPatchForIntervention(input.intervention);
	const currentContent = await readCurrentTargetContent(input.options, input.rootDir, patchPlan.target);
	return currentContent === null
		? patchPlan
		: hydratePatchPlanWithContent(input.intervention, patchPlan, currentContent);
}

async function readCurrentTargetContent(
	options: CircuitBreakerExecutionOptions,
	rootDir: string,
	target: string,
): Promise<string | null> {
	const candidateRoots = [options.agentDir, rootDir].filter((value): value is string => Boolean(value));
	for (const candidateRoot of candidateRoots) {
		try {
			return await readFile(join(candidateRoot, target), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return null;
}

async function analyzeCostIfPresent(
	rootDir: string,
	events: CircuitBreakerEvent[],
	identity: { agentName: string; model: string; rulesHash: string },
	updateBaseline?: boolean,
) {
	const assistantUsageEvents = events.filter((event) => event.type === "assistant_usage");
	const totalCost = assistantUsageEvents.reduce((sum, event) => sum + event.costUsd, 0);
	if (totalCost <= 0 || assistantUsageEvents.length === 0) return null;

	return analyzeCostAndUpdateBaseline(rootDir, {
		agentName: identity.agentName,
		model: identity.model,
		rulesHash: identity.rulesHash,
		costUsd: totalCost,
	}, {
		updateBaseline,
	});
}
