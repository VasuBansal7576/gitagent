import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";

import type { ToolLoopFinding } from "../examples/circuit-breaker/detector.ts";
import {
	createCostAnomalyIntervention,
	createToolLoopIntervention,
	writeInterventionRecord,
} from "../examples/circuit-breaker/intervention-writer.ts";

describe("circuit breaker intervention writer", () => {
	it("creates a traceable tool-loop intervention record", () => {
		const intervention = createToolLoopIntervention({
			sessionId: "session-abc",
			sessionEventLog: "memory/circuit-breaker/sessions/session-abc.jsonl",
			finding: finding(),
			agent: "research-agent",
			model: "anthropic:claude-sonnet-4",
			rulesHash: "abc12345",
			createdAt: "2026-05-23T12:30:00.000Z",
			patchTarget: "skills/research/SKILL.md",
		});

		assert.equal(intervention.id, "2026-05-23T12-30-00Z-tool-loop-v1");
		assert.equal(intervention.session_id, "session-abc");
		assert.equal(intervention.detector, "tool-loop-v1");
		assert.equal(intervention.action.status, "dry_run");
		assert.equal(intervention.action.pr_url, null);
		assert.equal(intervention.action.patch_target, "skills/research/SKILL.md");
		assert.deepEqual(intervention.evidence.event_indexes, [2, 3, 4, 5, 6, 7]);
		assert.equal(intervention.evidence.session_event_log, "memory/circuit-breaker/sessions/session-abc.jsonl");
	});

	it("writes the intervention YAML under memory/circuit-breaker/interventions", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "gitclaw-cb-"));
		const intervention = createToolLoopIntervention({
			sessionId: "session-abc",
			sessionEventLog: "memory/circuit-breaker/sessions/session-abc.jsonl",
			finding: finding(),
			createdAt: "2026-05-23T12:30:00.000Z",
		});

		const result = await writeInterventionRecord({ rootDir, intervention });
		assert.equal(
			result.path,
			join(rootDir, "memory", "circuit-breaker", "interventions", "2026-05-23T12-30-00Z-tool-loop-v1.yaml"),
		);

		const parsed = YAML.parse(await readFile(result.path, "utf8"));
		assert.deepEqual(parsed, intervention);
	});

	it("creates a cost anomaly intervention record with baseline evidence", () => {
		const intervention = createCostAnomalyIntervention({
			sessionId: "session-cost",
			sessionEventLog: "memory/circuit-breaker/sessions/session-cost.jsonl",
			classification: {
				type: "cost_anomaly",
				actual_cost: 2.5,
				p95_baseline: 0.5,
				anomaly_ratio: 5,
				baseline_samples: 5,
			},
			createdAt: "2026-05-23T12:31:00.000Z",
		});

		assert.equal(intervention.id, "2026-05-23T12-31-00Z-cost-spike-v1");
		assert.equal(intervention.detector, "cost-spike-v1");
		assert.equal(intervention.severity, "medium");
		assert.equal(intervention.action.patch_target, "agent.yaml");
		assert.equal(intervention.evidence.actual_cost_usd, 2.5);
		assert.equal(intervention.evidence.p95_baseline_usd, 0.5);
		assert.equal(intervention.evidence.anomaly_ratio, 5);
		assert.equal(intervention.evidence.baseline_samples, 5);
	});
});

function finding(): ToolLoopFinding {
	return {
		type: "tool_loop",
		detector: "tool-loop-v1",
		severity: "high",
		toolName: "search_docs",
		windowSize: 3,
		eventIndexes: [2, 3, 4, 5, 6, 7],
		toolCallIds: ["call-2", "call-3", "call-4"],
		argSimilarity: 1,
		resultDelta: 0,
		confidence: 1,
		argsWindow: [
			{ query: "gitclaw sdk events" },
			{ query: "gitclaw sdk events" },
			{ query: "gitclaw sdk events" },
		],
		resultItems: ["https://example.com/a"],
		newItems: [],
	};
}
