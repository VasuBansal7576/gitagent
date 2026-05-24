import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCircuitBreaker } from "../examples/circuit-breaker/run.ts";
import { verifyCircuitBreakerArtifacts } from "../examples/circuit-breaker/verify-artifacts.ts";

describe("circuit breaker artifact verifier", () => {
	it("verifies fixture evidence, intervention, patch, PR body, and calibration", async () => {
		const rootDir = await tempRoot();
		await runCircuitBreaker({
			rootDir,
			fixture: "examples/circuit-breaker/fixtures/search-loop-session.json",
			dryRun: true,
		});

		const summary = await verifyCircuitBreakerArtifacts({
			rootDir,
			sessionId: "search-loop-session",
			expectInterventions: 1,
			requirePatch: true,
			requirePrBody: true,
			requireCalibration: true,
		});

		assert.equal(summary.sessionCount, 1);
		assert.equal(summary.interventionCount, 1);
		assert.deepEqual(summary.checkedSessionIds, ["search-loop-session"]);
		assert.equal(summary.checkedInterventionIds.length, 1);
		assert.match(summary.calibrationPath ?? "", /memory\/circuit-breaker\/calibration\.md$/);
	});

	it("fails when an intervention cites an event index missing from the session log", async () => {
		const rootDir = await tempRoot();
		const sessionDir = join(rootDir, "memory", "circuit-breaker", "sessions");
		const interventionDir = join(rootDir, "memory", "circuit-breaker", "interventions");
		await mkdir(sessionDir, { recursive: true });
		await mkdir(interventionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "bad-session.jsonl"),
			JSON.stringify({
				sessionId: "bad-session",
				eventIndex: 0,
				observedAt: "2026-05-23T12:00:00.000Z",
				event: { type: "tool_use", toolCallId: "call-1", toolName: "search_docs", args: {} },
			}) + "\n",
			"utf8",
		);
		await writeFile(
			join(interventionDir, "bad.yaml"),
			[
				"id: bad",
				"session_id: bad-session",
				"evidence:",
				"  session_event_log: memory/circuit-breaker/sessions/bad-session.jsonl",
				"  event_indexes: [7]",
				"",
			].join("\n"),
			"utf8",
		);

		await assert.rejects(
			() => verifyCircuitBreakerArtifacts({ rootDir, sessionId: "bad-session" }),
			/cites missing eventIndex 7/,
		);
	});

	it("fails when an intervention points at a different session log than its session id", async () => {
		const rootDir = await tempRoot();
		const sessionDir = join(rootDir, "memory", "circuit-breaker", "sessions");
		const interventionDir = join(rootDir, "memory", "circuit-breaker", "interventions");
		await mkdir(sessionDir, { recursive: true });
		await mkdir(interventionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "claimed-session.jsonl"),
			JSON.stringify({
				sessionId: "claimed-session",
				eventIndex: 0,
				observedAt: "2026-05-23T12:00:00.000Z",
				event: { type: "tool_use", toolCallId: "call-1", toolName: "search_docs", args: {} },
			}) + "\n",
			"utf8",
		);
		await writeFile(
			join(interventionDir, "mismatch.yaml"),
			[
				"id: mismatch",
				"session_id: claimed-session",
				"evidence:",
				"  session_event_log: memory/circuit-breaker/sessions/other-session.jsonl",
				"  event_indexes: [0]",
				"",
			].join("\n"),
			"utf8",
		);

		await assert.rejects(
			() => verifyCircuitBreakerArtifacts({ rootDir, sessionId: "claimed-session" }),
			/session_event_log .* does not match session_id claimed-session/,
		);
	});

	it("fails when a required patch artifact is not a unified diff", async () => {
		const rootDir = await tempRoot();
		const sessionDir = join(rootDir, "memory", "circuit-breaker", "sessions");
		const interventionDir = join(rootDir, "memory", "circuit-breaker", "interventions");
		await mkdir(sessionDir, { recursive: true });
		await mkdir(interventionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "patch-session.jsonl"),
			JSON.stringify({
				sessionId: "patch-session",
				eventIndex: 0,
				observedAt: "2026-05-23T12:00:00.000Z",
				event: { type: "tool_use", toolCallId: "call-1", toolName: "search_docs", args: {} },
			}) + "\n",
			"utf8",
		);
		const interventionPath = join(interventionDir, "patch.yaml");
		await writeFile(
			interventionPath,
			[
				"id: patch",
				"session_id: patch-session",
				"evidence:",
				"  session_event_log: memory/circuit-breaker/sessions/patch-session.jsonl",
				"  event_indexes: [0]",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(`${interventionPath}.patch.diff`, "not a diff\n", "utf8");

		await assert.rejects(
			() => verifyCircuitBreakerArtifacts({ rootDir, sessionId: "patch-session", requirePatch: true }),
			/patch\.diff is not a unified diff/,
		);
	});

	it("scopes intervention checks to the requested session id", async () => {
		const rootDir = await tempRoot();
		const sessionDir = join(rootDir, "memory", "circuit-breaker", "sessions");
		const interventionDir = join(rootDir, "memory", "circuit-breaker", "interventions");
		await mkdir(sessionDir, { recursive: true });
		await mkdir(interventionDir, { recursive: true });

		await writeSession(sessionDir, "current-session");
		await writeSession(sessionDir, "older-session");
		await writeIntervention(interventionDir, "current", "current-session");
		await writeIntervention(interventionDir, "older", "older-session", {
			sessionEventLog: "memory/circuit-breaker/sessions/not-older-session.jsonl",
		});
		await writeFile(join(interventionDir, "current.yaml.patch.diff"), unifiedDiff(), "utf8");
		await writeFile(join(interventionDir, "current.yaml.pr.md"), "PR body\n", "utf8");

		const summary = await verifyCircuitBreakerArtifacts({
			rootDir,
			sessionId: "current-session",
			expectInterventions: 1,
			requirePatch: true,
			requirePrBody: true,
		});

		assert.deepEqual(summary.checkedSessionIds, ["current-session"]);
		assert.deepEqual(summary.checkedInterventionIds, ["current"]);
		assert.equal(summary.interventionCount, 1);
	});
});

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gitclaw-cb-verify-"));
}

async function writeSession(sessionDir: string, sessionId: string) {
	await writeFile(
		join(sessionDir, `${sessionId}.jsonl`),
		JSON.stringify({
			sessionId,
			eventIndex: 0,
			observedAt: "2026-05-23T12:00:00.000Z",
			event: { type: "tool_use", toolCallId: "call-1", toolName: "search_docs", args: {} },
		}) + "\n",
		"utf8",
	);
}

async function writeIntervention(
	interventionDir: string,
	id: string,
	sessionId: string,
	options: { sessionEventLog?: string } = {},
) {
	await writeFile(
		join(interventionDir, `${id}.yaml`),
		[
			`id: ${id}`,
			`session_id: ${sessionId}`,
			"evidence:",
			`  session_event_log: ${options.sessionEventLog ?? `memory/circuit-breaker/sessions/${sessionId}.jsonl`}`,
			"  event_indexes: [0]",
			"",
		].join("\n"),
		"utf8",
	);
}

function unifiedDiff(): string {
	return [
		"--- a/RULES.md",
		"+++ b/RULES.md",
		"@@ -1,1 +1,2 @@",
		" # Rules",
		"+- Guardrail",
		"",
	].join("\n");
}
