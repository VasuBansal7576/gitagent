import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CircuitBreakerIntervention } from "../examples/circuit-breaker/intervention-writer.ts";
import { planPatchForIntervention } from "../examples/circuit-breaker/patch-planner.ts";

describe("circuit breaker patch planner", () => {
	it("generates a targeted dry-run patch and PR body for tool loops", () => {
		const plan = planPatchForIntervention(intervention());

		assert.equal(plan.target, "RULES.md");
		assert.match(plan.rationale, /Repeated search_docs calls/);
		assert.match(plan.patch, /--- a\/RULES\.md/);
		assert.match(plan.patch, /When search_docs repeats with similar arguments/);
		assert.match(plan.prTitle, /search_docs loop/);
		assert.match(plan.prBody, /Event indexes: `2, 3, 4, 5, 6, 7`/);
		assert.match(plan.prBody, /Evidence log: `memory\/circuit-breaker\/sessions\/session-abc\.jsonl`/);
		assert.match(plan.prBody, /```diff/);
	});

	it("fails loudly for unsupported detectors", () => {
		assert.throws(
			() => planPatchForIntervention({ ...intervention(), detector: "unknown-detector" }),
			/No patch planner for detector: unknown-detector/,
		);
	});

	it("targets agent.yaml for pure cost anomalies", () => {
		const plan = planPatchForIntervention(costIntervention());

		assert.equal(plan.target, "agent.yaml");
		assert.match(plan.rationale, /\$2\.5000 was 5x the p95 baseline/);
		assert.match(plan.patch, /--- a\/agent\.yaml/);
		assert.match(plan.patch, /budget_guardrails:/);
		assert.match(plan.prTitle, /budget guardrail/);
		assert.match(plan.prBody, /Actual cost: `\$2\.5000`/);
		assert.match(plan.prBody, /Baseline samples: `5`/);
	});
});

function intervention(): CircuitBreakerIntervention {
	return {
		id: "2026-05-23T12-30-00Z-tool-loop-v1",
		session_id: "session-abc",
		agent: "research-agent",
		model: "anthropic:claude-sonnet-4",
		rules_hash: "abc12345",
		detector: "tool-loop-v1",
		severity: "high",
		evidence: {
			session_event_log: "memory/circuit-breaker/sessions/session-abc.jsonl",
			event_indexes: [2, 3, 4, 5, 6, 7],
			tool: "search_docs",
			window_size: 3,
			arg_similarity: 1,
			result_delta: 0,
			confidence: 1,
			tool_call_ids: ["call-2", "call-3", "call-4"],
		},
		action: {
			type: "pull_request",
			status: "dry_run",
			pr_url: null,
			patch_target: "RULES.md",
		},
		human_decision: null,
		created_at: "2026-05-23T12:30:00.000Z",
	};
}

function costIntervention(): CircuitBreakerIntervention {
	return {
		id: "2026-05-23T12-30-00Z-cost-spike-v1",
		session_id: "session-cost",
		agent: "research-agent",
		model: "anthropic:claude-sonnet-4",
		rules_hash: "abc12345",
		detector: "cost-spike-v1",
		severity: "medium",
		evidence: {
			session_event_log: "memory/circuit-breaker/sessions/session-cost.jsonl",
			event_indexes: [],
			actual_cost_usd: 2.5,
			p95_baseline_usd: 0.5,
			anomaly_ratio: 5,
			baseline_samples: 5,
		},
		action: {
			type: "pull_request",
			status: "dry_run",
			pr_url: null,
			patch_target: "agent.yaml",
		},
		human_decision: null,
		created_at: "2026-05-23T12:30:00.000Z",
	};
}
