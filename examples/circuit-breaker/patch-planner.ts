import type { CircuitBreakerIntervention } from "./intervention-writer.js";

export interface PatchPlan {
	target: string;
	rationale: string;
	patch: string;
	prTitle: string;
	prBody: string;
}

export function planPatchForIntervention(intervention: CircuitBreakerIntervention): PatchPlan {
	if (!["tool-loop-v1", "cost-spike-v1"].includes(intervention.detector)) {
		throw new Error(`No patch planner for detector: ${intervention.detector}`);
	}

	const target = intervention.action.patch_target || inferTarget(intervention);
	const rationale = buildRationale(intervention);
	const patch = buildPatch(intervention, target);
	const prTitle = buildPrTitle(intervention);
	const prBody = buildPrBody(intervention, rationale, patch);

	return {
		target,
		rationale,
		patch,
		prTitle,
		prBody,
	};
}

function inferTarget(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") return "agent.yaml";
	const toolName = intervention.evidence.tool ?? "";
	const lowered = toolName.toLowerCase();
	if (/(search|read|list|grep|glob)/.test(lowered)) return "RULES.md";
	if (/(shell|bash|exec|cli)/.test(lowered)) return "RULES.md";
	return "RULES.md";
}

function buildPatch(intervention: CircuitBreakerIntervention, target: string): string {
	const block = renderPatchBlock(intervention).trimEnd().split("\n").map((line) => `+${line}`).join("\n");
	return [
		`--- a/${target}`,
		`+++ b/${target}`,
		"@@",
		block,
		"",
	].join("\n");
}

export function renderPatchBlock(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") {
		return renderBudgetGuardrailBlock(intervention);
	}
	return renderToolGuardrailBlock(intervention);
}

export function renderGuardrailBlock(intervention: CircuitBreakerIntervention): string {
	return renderPatchBlock(intervention);
}

function renderToolGuardrailBlock(intervention: CircuitBreakerIntervention): string {
	const toolName = intervention.evidence.tool ?? "the same tool";
	return [
		"## Runaway Tool Guardrails",
		`- When ${toolName} repeats with similar arguments, stop after 3 low-progress calls.`,
		"- If the last 2 tool results add 0 new stable URLs, files, ids, or SHAs, change strategy or stop.",
		"- Record why continuing is expected to produce new information before calling the same tool again.",
		"",
	].join("\n");
}

function renderBudgetGuardrailBlock(intervention: CircuitBreakerIntervention): string {
	const p95 = intervention.evidence.p95_baseline_usd ?? 0;
	const maxCost = Math.max(0.01, Math.ceil(p95 * 300) / 100);
	return [
		"budget_guardrails:",
		`  max_cost_usd_per_run: ${maxCost.toFixed(2)}`,
		"  on_exceeded: stop_and_request_review",
		"  source: circuit-breaker cost-spike-v1",
		"",
	].join("\n");
}

export function applyPatchPlanToContent(content: string, intervention: CircuitBreakerIntervention): {
	changed: boolean;
	content: string;
} {
	const guardrailBlock = renderPatchBlock(intervention).trimEnd();
	if (content.includes(guardrailBlock)) {
		return { changed: false, content };
	}

	const separator = content.endsWith("\n") ? "\n" : "\n\n";
	return {
		changed: true,
		content: `${content.trimEnd()}${separator}${guardrailBlock}\n`,
	};
}

function buildPrBody(intervention: CircuitBreakerIntervention, rationale: string, patch: string): string {
	const evidenceLines = buildEvidenceLines(intervention);
	return [
		`## Circuit Breaker Fired: ${intervention.detector}`,
		"",
		"### What Fired",
		`- Session: \`${intervention.session_id}\``,
		`- Evidence log: \`${intervention.evidence.session_event_log}\``,
		...evidenceLines,
		"",
		"### Why This Is Risky",
		rationale,
		"",
		"### Proposed Change",
		`Patch target: \`${intervention.action.patch_target}\``,
		"",
		"```diff",
		patch.trimEnd(),
		"```",
		"",
		"### How To Test",
		"- Re-run the same prompt and confirm repeated low-progress tool calls stop or change strategy.",
		"- Re-run the circuit breaker fixture and confirm it still cites the same evidence indexes.",
		"",
		`Mode: \`${intervention.action.status}\``,
	].join("\n");
}

function buildRationale(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") {
		return `Run cost $${intervention.evidence.actual_cost_usd?.toFixed(4)} was ${intervention.evidence.anomaly_ratio}x the p95 baseline after ${intervention.evidence.baseline_samples} samples.`;
	}
	return `Repeated ${intervention.evidence.tool} calls returned low new-result delta (${intervention.evidence.result_delta}).`;
}

function buildPrTitle(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") {
		return "circuit-breaker: add budget guardrail for cost spike";
	}
	return `circuit-breaker: add guardrail for ${intervention.evidence.tool} loop`;
}

function buildEvidenceLines(intervention: CircuitBreakerIntervention): string[] {
	if (intervention.detector === "cost-spike-v1") {
		return [
			`- Actual cost: \`$${intervention.evidence.actual_cost_usd?.toFixed(4)}\``,
			`- p95 baseline: \`$${intervention.evidence.p95_baseline_usd?.toFixed(4)}\``,
			`- Anomaly ratio: \`${intervention.evidence.anomaly_ratio}x\``,
			`- Baseline samples: \`${intervention.evidence.baseline_samples}\``,
		];
	}
	return [
		`- Tool: \`${intervention.evidence.tool}\``,
		`- Event indexes: \`${intervention.evidence.event_indexes.join(", ")}\``,
		`- Argument similarity: \`${intervention.evidence.arg_similarity}\``,
		`- Result delta: \`${intervention.evidence.result_delta}\``,
		`- Confidence: \`${intervention.evidence.confidence}\``,
	];
}
