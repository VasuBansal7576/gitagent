import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

import type { ToolLoopFinding } from "./detector.js";
import type { CostClassification } from "./cost-baseline.ts";

export interface ToolLoopInterventionInput {
	sessionId: string;
	sessionEventLog: string;
	finding: ToolLoopFinding;
	agent?: string;
	model?: string;
	rulesHash?: string;
	createdAt?: Date | string;
	status?: "dry_run" | "opened_pr";
	prUrl?: string | null;
	patchTarget?: string;
}

export interface CostAnomalyInterventionInput {
	sessionId: string;
	sessionEventLog: string;
	classification: Extract<CostClassification, { type: "cost_anomaly" }>;
	agent?: string;
	model?: string;
	rulesHash?: string;
	createdAt?: Date | string;
	status?: "dry_run" | "opened_pr";
	prUrl?: string | null;
	patchTarget?: string;
}

export interface CircuitBreakerIntervention {
	id: string;
	session_id: string;
	agent: string;
	model: string;
	rules_hash: string;
	detector: string;
	severity: string;
	evidence: {
		session_event_log: string;
		event_indexes: number[];
		tool?: string;
		window_size?: number;
		arg_similarity?: number;
		result_delta?: number;
		confidence?: number;
		tool_call_ids?: string[];
		actual_cost_usd?: number;
		p95_baseline_usd?: number;
		anomaly_ratio?: number;
		baseline_samples?: number;
	};
	action: {
		type: "pull_request";
		status: "dry_run" | "opened_pr";
		pr_url: string | null;
		patch_target: string;
	};
	human_decision: null;
	created_at: string;
}

export interface WriteInterventionOptions {
	rootDir?: string;
	intervention: CircuitBreakerIntervention;
}

export interface WriteInterventionResult {
	path: string;
	intervention: CircuitBreakerIntervention;
}

export function createToolLoopIntervention(input: ToolLoopInterventionInput): CircuitBreakerIntervention {
	const createdAt = normalizeCreatedAt(input.createdAt);
	return {
		id: `${formatInterventionTimestamp(createdAt)}-${input.finding.detector}`,
		session_id: input.sessionId,
		agent: input.agent ?? "unknown",
		model: input.model ?? "unknown",
		rules_hash: input.rulesHash ?? "unknown",
		detector: input.finding.detector,
		severity: input.finding.severity,
		evidence: {
			session_event_log: input.sessionEventLog,
			event_indexes: input.finding.eventIndexes,
			tool: input.finding.toolName,
			window_size: input.finding.windowSize,
			arg_similarity: input.finding.argSimilarity,
			result_delta: input.finding.resultDelta,
			confidence: input.finding.confidence,
			tool_call_ids: input.finding.toolCallIds,
		},
		action: {
			type: "pull_request",
			status: input.status ?? "dry_run",
			pr_url: input.prUrl ?? null,
			patch_target: input.patchTarget ?? "RULES.md",
		},
		human_decision: null,
		created_at: createdAt.toISOString(),
	};
}

export function createCostAnomalyIntervention(input: CostAnomalyInterventionInput): CircuitBreakerIntervention {
	const createdAt = normalizeCreatedAt(input.createdAt);
	return {
		id: `${formatInterventionTimestamp(createdAt)}-cost-spike-v1`,
		session_id: input.sessionId,
		agent: input.agent ?? "unknown",
		model: input.model ?? "unknown",
		rules_hash: input.rulesHash ?? "unknown",
		detector: "cost-spike-v1",
		severity: "medium",
		evidence: {
			session_event_log: input.sessionEventLog,
			event_indexes: [],
			actual_cost_usd: input.classification.actual_cost,
			p95_baseline_usd: input.classification.p95_baseline,
			anomaly_ratio: input.classification.anomaly_ratio,
			baseline_samples: input.classification.baseline_samples,
		},
		action: {
			type: "pull_request",
			status: input.status ?? "dry_run",
			pr_url: input.prUrl ?? null,
			patch_target: input.patchTarget ?? "agent.yaml",
		},
		human_decision: null,
		created_at: createdAt.toISOString(),
	};
}

export async function writeInterventionRecord(options: WriteInterventionOptions): Promise<WriteInterventionResult> {
	const interventionsDir = getInterventionsDir(options.rootDir);
	await mkdir(interventionsDir, { recursive: true });

	const path = join(interventionsDir, `${options.intervention.id}.yaml`);
	await writeFile(path, YAML.stringify(options.intervention), "utf8");
	return { path, intervention: options.intervention };
}

function getInterventionsDir(rootDir = process.cwd()): string {
	return join(rootDir, "memory", "circuit-breaker", "interventions");
}

function normalizeCreatedAt(createdAt?: Date | string): Date {
	if (createdAt instanceof Date) return createdAt;
	if (typeof createdAt === "string") return new Date(createdAt);
	return new Date();
}

function formatInterventionTimestamp(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}
