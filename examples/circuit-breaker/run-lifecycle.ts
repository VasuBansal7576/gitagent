import { writeFile } from "node:fs/promises";

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
import { planPatchForIntervention } from "./patch-planner.ts";
import { resolveRunIdentity } from "./run-identity.ts";

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
	const costAnalysis = await analyzeCostIfPresent(rootDir, options.events, identity);

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
			};
		}

		const calibration = await updateCalibration(rootDir);
		return {
			sessionId: options.sessionId,
			sessionEventLog: getSessionEventLogPath(options.sessionId, rootDir),
			normalizedEventCount: evidence.events.length,
			findingCount: 0,
			costClassification: costAnalysis?.classification,
			costBaselinePath: costAnalysis?.path,
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
	const patchPlan = planPatchForIntervention(intervention);
	const patchPath = `${written.path}.patch.diff`;
	const prBodyPath = `${written.path}.pr.md`;
	await writeFile(patchPath, patchPlan.patch, "utf8");
	await writeFile(prBodyPath, patchPlan.prBody, "utf8");
	let githubPr: GitHubPrResult | undefined;

	if (options.openPr) {
		githubPr = await openGitHubPrForPatch({
			token: options.githubToken ?? process.env.GITHUB_TOKEN ?? "",
			repository: options.githubRepository ?? process.env.TARGET_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "",
			intervention,
			patchPlan,
			baseBranch: options.baseBranch,
			branchName: options.branchName,
			fetchImpl: options.fetchImpl,
		});
		const openedIntervention = {
			...intervention,
			action: {
				...intervention.action,
				status: "opened_pr" as const,
				pr_url: githubPr.url,
			},
		};
		await writeInterventionRecord({ rootDir, intervention: openedIntervention });
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

async function analyzeCostIfPresent(
	rootDir: string,
	events: CircuitBreakerEvent[],
	identity: { agentName: string; model: string; rulesHash: string },
) {
	const assistantUsageEvents = events.filter((event) => event.type === "assistant_usage");
	const totalCost = assistantUsageEvents.reduce((sum, event) => sum + event.costUsd, 0);
	if (totalCost <= 0 || assistantUsageEvents.length === 0) return null;

	return analyzeCostAndUpdateBaseline(rootDir, {
		agentName: identity.agentName,
		model: identity.model,
		rulesHash: identity.rulesHash,
		costUsd: totalCost,
	});
}
