import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	analyzeCostAndUpdateBaseline,
	classifyCost,
	type CostBaseline,
} from "../examples/circuit-breaker/cost-baseline.ts";

describe("circuit breaker cost baseline", () => {
	it("classifies against the previous baseline and quarantines anomalous samples", async () => {
		const rootDir = await tempRoot();

		for (let index = 0; index < 5; index += 1) {
			await analyzeCostAndUpdateBaseline(rootDir, sample(1, `2026-05-23T12:00:0${index}.000Z`), { updateBaseline: true });
		}

		const result = await analyzeCostAndUpdateBaseline(rootDir, sample(4, "2026-05-23T12:01:00.000Z"), { updateBaseline: true });

		assert.equal(result.previousBaseline?.sample_count, 5);
		assert.equal(result.previousBaseline?.p95_cost_per_run, 1);
		assert.equal(result.classification.type, "cost_anomaly");
		if (result.classification.type === "cost_anomaly") {
			assert.equal(result.classification.p95_baseline, 1);
			assert.equal(result.classification.anomaly_ratio, 4);
			assert.equal(result.classification.baseline_samples, 5);
		}
		assert.equal(result.updatedBaseline.sample_count, 5);
		assert.equal(result.updatedBaseline.max_observed, 1);
		assert.ok(result.quarantinedAnomalyPath);
		await access(result.quarantinedAnomalyPath);
	});

	it("uses absolute budget warnings until baseline has enough samples", () => {
		const baseline = baselineWithSamples([0.1, 0.2, 0.3, 0.4]);

		assert.deepEqual(classifyCost(1.5, baseline), {
			type: "absolute_budget_warning",
			actual_cost: 1.5,
			absolute_floor_usd: 1,
			baseline_samples: 4,
		});
	});

	it("does not call low-sample low-cost runs anomalous", () => {
		assert.deepEqual(classifyCost(0.5, baselineWithSamples([0.1, 0.2])), {
			type: "none",
			actual_cost: 0.5,
			reason: "insufficient_baseline_samples",
			baseline_samples: 2,
		});
	});
});

function sample(costUsd: number, observedAt: string) {
	return {
		agentName: "research-agent",
		model: "anthropic:claude-sonnet-4",
		rulesHash: "abc123",
		costUsd,
		observedAt,
	};
}

function baselineWithSamples(samples: number[]): CostBaseline {
	return {
		key: "test",
		agent_name: "research-agent",
		model: "anthropic:claude-sonnet-4",
		rules_hash: "abc123",
		samples,
		sample_count: samples.length,
		avg_cost_per_run: 0.25,
		p95_cost_per_run: Math.max(...samples),
		max_observed: Math.max(...samples),
		last_updated: "2026-05-23T12:00:00.000Z",
	};
}

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gitclaw-cb-cost-"));
}
