import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";

import { updateCalibration } from "../examples/circuit-breaker/calibration.ts";

describe("circuit breaker calibration", () => {
	it("writes an honest empty calibration file before any interventions exist", async () => {
		const rootDir = await tempRoot();
		const summary = await updateCalibration(rootDir, new Date("2026-05-23T12:00:00.000Z"));

		assert.equal(summary.totalInterventions, 0);
		assert.equal(summary.totalPending, 0);

		const content = await readFile(summary.path, "utf8");
		assert.match(content, /Total interventions: 0/);
		assert.match(content, /\| none \| 0 \| 0 \| 0 \| 0 \| N\/A \|/);
		assert.match(content, /Pending records are not counted as true or false positives/);
	});

	it("summarizes merged, rejected, and pending interventions by detector", async () => {
		const rootDir = await tempRoot();
		await writeRecord(rootDir, "1.yaml", {
			id: "one",
			detector: "tool-loop-v1",
			human_decision: "merged",
			action: { status: "opened_pr", pr_url: "https://github.com/owner/repo/pull/1" },
		});
		await writeRecord(rootDir, "2.yaml", {
			id: "two",
			detector: "tool-loop-v1",
			human_decision: "rejected",
			action: { status: "opened_pr", pr_url: "https://github.com/owner/repo/pull/2" },
		});
		await writeRecord(rootDir, "3.yaml", {
			id: "three",
			detector: "tool-loop-v1",
			human_decision: null,
			action: { status: "dry_run", pr_url: null },
		});

		const summary = await updateCalibration(rootDir, new Date("2026-05-23T12:30:00.000Z"));

		assert.equal(summary.totalInterventions, 3);
		assert.equal(summary.totalPending, 1);
		assert.equal(summary.totalTruePositive, 1);
		assert.equal(summary.totalFalsePositive, 1);
		assert.deepEqual(summary.detectors["tool-loop-v1"], {
			total: 3,
			pending: 1,
			truePositive: 1,
			falsePositive: 1,
			precision: 0.5,
		});

		const content = await readFile(summary.path, "utf8");
		assert.match(content, /\| tool-loop-v1 \| 3 \| 1 \| 1 \| 1 \| 50\.0% \|/);
		assert.match(content, /one \| tool-loop-v1 \| merged \| PR: https:\/\/github\.com\/owner\/repo\/pull\/1/);
		assert.match(content, /three \| tool-loop-v1 \| pending/);
	});
});

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gitclaw-cb-calibration-"));
}

async function writeRecord(rootDir: string, name: string, record: unknown): Promise<void> {
	const dir = join(rootDir, "memory", "circuit-breaker", "interventions");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), YAML.stringify(record), "utf8");
}
