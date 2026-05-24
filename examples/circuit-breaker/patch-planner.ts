import type { CircuitBreakerIntervention } from "./intervention-writer.js";

export interface PatchPlan {
	target: string;
	rationale: string;
	contentBlock: string;
	patch: string;
	prTitle: string;
	prBody: string;
}

export interface PatchPlanOptions {
	currentContent?: string;
}

export function planPatchForIntervention(
	intervention: CircuitBreakerIntervention,
	options: PatchPlanOptions = {},
): PatchPlan {
	if (intervention.detector !== "tool-loop-v1" && intervention.detector !== "cost-spike-v1") {
		throw new Error(`No patch planner for detector: ${intervention.detector}`);
	}

	const target = resolveTarget(intervention);
	const rationale = buildRationale(intervention);
	const contentBlock = renderPatchBlock(intervention);
	const patch = buildPatch(contentBlock, target, options.currentContent);
	const prTitle = buildPrTitle(intervention);
	const prBody = buildPrBody(intervention, target, rationale, patch);

	return {
		target,
		rationale,
		contentBlock,
		patch,
		prTitle,
		prBody,
	};
}

export function hydratePatchPlanWithContent(
	intervention: CircuitBreakerIntervention,
	patchPlan: PatchPlan,
	currentContent: string,
): PatchPlan {
	const patch = buildPatch(patchPlan.contentBlock, patchPlan.target, currentContent);
	return {
		...patchPlan,
		patch,
		prBody: buildPrBody(intervention, patchPlan.target, patchPlan.rationale, patch),
	};
}

function resolveTarget(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1" && intervention.action.patch_target === "agent.yaml") {
		return "RULES.md";
	}
	return validatePatchTarget(intervention.action.patch_target || inferTarget(intervention));
}

function inferTarget(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") return "RULES.md";
	const toolName = intervention.evidence.tool ?? "";
	const lowered = toolName.toLowerCase();
	if (/(search|read|list|grep|glob)/.test(lowered)) return "RULES.md";
	if (/(shell|bash|exec|cli)/.test(lowered)) return "RULES.md";
	return "RULES.md";
}

function buildPatch(contentBlock: string, target: string, currentContent?: string): string {
	if (currentContent !== undefined) {
		return buildAppendUnifiedDiff(target, currentContent, applyContentBlock(currentContent, contentBlock).content);
	}

	const blockLines = contentBlock.trimEnd().split("\n");
	return [
		"--- /dev/null",
		`+++ b/${target}`,
		`@@ -0,0 +1,${blockLines.length} @@`,
		...blockLines.map((line) => `+${line}`),
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
	const toolName = safeToolName(intervention.evidence.tool);
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
		"## Cost Guardrails",
		`- Stop and request review when a run is projected to exceed $${maxCost.toFixed(2)} or 3x the established p95 baseline.`,
		"- Before continuing an expensive run, explain what new evidence the next step is expected to produce.",
		"- Prefer narrowing scope, lowering max turns, or switching strategy over repeating broad calls after a cost spike.",
		"",
	].join("\n");
}

export function applyPatchPlanToContent(content: string, patchPlan: PatchPlan): {
	changed: boolean;
	content: string;
} {
	return applyContentBlock(content, patchPlan.contentBlock);
}

function applyContentBlock(content: string, contentBlock: string): {
	changed: boolean;
	content: string;
} {
	const guardrailBlock = contentBlock.trimEnd();
	if (content.includes(guardrailBlock)) {
		return { changed: false, content };
	}

	const separator = content.endsWith("\n") ? "\n" : "\n\n";
	return {
		changed: true,
		content: `${content.trimEnd()}${separator}${guardrailBlock}\n`,
	};
}

function buildAppendUnifiedDiff(target: string, currentContent: string, patchedContent: string): string {
	const oldLines = linesForDiff(currentContent);
	const newLines = linesForDiff(patchedContent);
	const addedLines = newLines.slice(oldLines.length);
	const oldRange = oldLines.length === 0 ? "0,0" : `1,${oldLines.length}`;
	const newRange = newLines.length === 0 ? "0,0" : `1,${newLines.length}`;

	return [
		`--- a/${target}`,
		`+++ b/${target}`,
		`@@ -${oldRange} +${newRange} @@`,
		...oldLines.map((line) => ` ${line}`),
		...addedLines.map((line) => `+${line}`),
		"",
	].join("\n");
}

function linesForDiff(content: string): string[] {
	if (content.length === 0) return [];
	return content.replace(/\n$/, "").split("\n");
}

function buildPrBody(intervention: CircuitBreakerIntervention, target: string, rationale: string, patch: string): string {
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
		`Patch target: \`${target}\``,
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
	return `Repeated ${safeToolName(intervention.evidence.tool)} calls returned low new-result delta (${intervention.evidence.result_delta}).`;
}

function buildPrTitle(intervention: CircuitBreakerIntervention): string {
	if (intervention.detector === "cost-spike-v1") {
		return "circuit-breaker: add rules guardrail for cost spike";
	}
	return `circuit-breaker: add guardrail for ${safeToolName(intervention.evidence.tool)} loop`;
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
		`- Tool: \`${safeToolName(intervention.evidence.tool)}\``,
		`- Event indexes: \`${intervention.evidence.event_indexes.join(", ")}\``,
		`- Argument similarity: \`${intervention.evidence.arg_similarity}\``,
		`- Result delta: \`${intervention.evidence.result_delta}\``,
		`- Confidence: \`${intervention.evidence.confidence}\``,
	];
}

function safeToolName(value: unknown): string {
	if (typeof value !== "string") return "the same tool";
	const match = value.match(/[A-Za-z0-9._:-]+/);
	return match?.[0] ?? "the same tool";
}

function validatePatchTarget(target: string): string {
	if (
		target.length === 0 ||
		target.startsWith("/") ||
		target.includes("\\") ||
		/[\0\r\n]/.test(target) ||
		target.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(`Unsafe patch target: ${target}`);
	}

	if (
		target === "RULES.md" ||
		target === "agent.yaml" ||
		/^(skills|tools)\/[A-Za-z0-9._/-]+\.(md|yaml|yml)$/.test(target)
	) {
		return target;
	}

	throw new Error(`Unsafe patch target: ${target}`);
}
