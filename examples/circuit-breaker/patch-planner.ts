import type { CircuitBreakerIntervention } from "./intervention-writer.js";

export interface PatchPlan {
	target: string;
	rationale: string;
	patch: string;
	prTitle: string;
	prBody: string;
}

export function planPatchForIntervention(intervention: CircuitBreakerIntervention): PatchPlan {
	if (intervention.detector !== "tool-loop-v1") {
		throw new Error(`No patch planner for detector: ${intervention.detector}`);
	}

	const target = intervention.action.patch_target || inferTarget(intervention.evidence.tool);
	const rationale = `Repeated ${intervention.evidence.tool} calls returned low new-result delta (${intervention.evidence.result_delta}).`;
	const patch = buildRulesPatch(intervention, target);
	const prTitle = `circuit-breaker: add guardrail for ${intervention.evidence.tool} loop`;
	const prBody = buildPrBody(intervention, rationale, patch);

	return {
		target,
		rationale,
		patch,
		prTitle,
		prBody,
	};
}

function inferTarget(toolName: string): string {
	const lowered = toolName.toLowerCase();
	if (/(search|read|list|grep|glob)/.test(lowered)) return "RULES.md";
	if (/(shell|bash|exec|cli)/.test(lowered)) return "RULES.md";
	return "RULES.md";
}

function buildRulesPatch(intervention: CircuitBreakerIntervention, target: string): string {
	const block = renderGuardrailBlock(intervention).trimEnd().split("\n").map((line) => `+${line}`).join("\n");
	return [
		`--- a/${target}`,
		`+++ b/${target}`,
		"@@",
		block,
		"",
	].join("\n");
}

export function renderGuardrailBlock(intervention: CircuitBreakerIntervention): string {
	const toolName = intervention.evidence.tool;
	return [
		"## Runaway Tool Guardrails",
		`- When ${toolName} repeats with similar arguments, stop after 3 low-progress calls.`,
		"- If the last 2 tool results add 0 new stable URLs, files, ids, or SHAs, change strategy or stop.",
		"- Record why continuing is expected to produce new information before calling the same tool again.",
		"",
	].join("\n");
}

export function applyPatchPlanToContent(content: string, intervention: CircuitBreakerIntervention): {
	changed: boolean;
	content: string;
} {
	const guardrailBlock = renderGuardrailBlock(intervention).trimEnd();
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
	return [
		`## Circuit Breaker Fired: ${intervention.detector}`,
		"",
		"### What Fired",
		`- Session: \`${intervention.session_id}\``,
		`- Tool: \`${intervention.evidence.tool}\``,
		`- Evidence log: \`${intervention.evidence.session_event_log}\``,
		`- Event indexes: \`${intervention.evidence.event_indexes.join(", ")}\``,
		`- Argument similarity: \`${intervention.evidence.arg_similarity}\``,
		`- Result delta: \`${intervention.evidence.result_delta}\``,
		`- Confidence: \`${intervention.evidence.confidence}\``,
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
