import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CircuitBreakerEventSchemaError } from "../examples/circuit-breaker/message-adapter.ts";
import { runCircuitBreaker } from "../examples/circuit-breaker/run.ts";
import type { GCMessage } from "../src/sdk-types.ts";

describe("circuit breaker fixture runner", () => {
	it("writes evidence, intervention, patch, and PR body for the loop fixture", async () => {
		const rootDir = await tempRoot();
		const summary = await runCircuitBreaker({
			rootDir,
			fixture: "examples/circuit-breaker/fixtures/search-loop-session.json",
			dryRun: true,
		});

		assert.equal(summary.sessionId, "search-loop-session");
		assert.equal(summary.findingCount, 1);
		assert.equal(summary.normalizedEventCount, 9);
		assert.ok(summary.interventionPath);
		assert.ok(summary.patchPath);
		assert.ok(summary.prBodyPath);

		await access(summary.sessionEventLog);
		await access(summary.interventionPath);
		await access(summary.patchPath);
		await access(summary.prBodyPath);

		const prBody = await readFile(summary.prBodyPath, "utf8");
		assert.match(prBody, /Event indexes: `3, 4, 5, 6, 7, 8`/);
		assert.match(prBody, /search_docs/);
	});

	it("writes evidence but no intervention for normal and cost fixtures", async () => {
		for (const fixture of [
			"examples/circuit-breaker/fixtures/normal-session.json",
			"examples/circuit-breaker/fixtures/cost-spike-session.json",
		]) {
			const rootDir = await tempRoot();
			const summary = await runCircuitBreaker({ rootDir, fixture, dryRun: true });
			assert.equal(summary.findingCount, 0);
			assert.equal(summary.interventionPath, undefined);
			await access(summary.sessionEventLog);
		}
	});

	it("fails loudly for malformed fixtures", async () => {
		const rootDir = await tempRoot();
		await assert.rejects(
			() => runCircuitBreaker({
				rootDir,
				fixture: "examples/circuit-breaker/fixtures/malformed-session.json",
				dryRun: true,
			}),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "tool_use.toolCallId must be a non-empty string",
		);
	});

	it("captures an injected live SDK message source through the same dry-run path", async () => {
		const rootDir = await tempRoot();
		const summary = await runCircuitBreaker({
			rootDir,
			sessionId: "live-test-session",
			messageSource: liveLoopMessages(),
			dryRun: true,
		});

		assert.equal(summary.sessionId, "live-test-session");
		assert.equal(summary.findingCount, 1);
		assert.equal(summary.normalizedEventCount, 8);
		assert.ok(summary.interventionPath);
		await access(summary.sessionEventLog);
		await access(summary.interventionPath);
	});
});

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gitclaw-cb-run-"));
}

async function* liveLoopMessages(): AsyncIterable<GCMessage> {
	for (const message of [
		toolUse("live-1"),
		toolResult("live-1"),
		toolUse("live-2"),
		toolResult("live-2"),
		toolUse("live-3"),
		toolResult("live-3"),
		toolUse("live-4"),
		toolResult("live-4"),
	]) {
		yield message;
	}
}

function toolUse(toolCallId: string): GCMessage {
	return {
		type: "tool_use",
		toolCallId,
		toolName: "search_docs",
		args: { query: "gitclaw sdk events" },
	};
}

function toolResult(toolCallId: string): GCMessage {
	return {
		type: "tool_result",
		toolCallId,
		toolName: "search_docs",
		content: "{\"results\":[{\"url\":\"https://example.com/a\"}]}",
		isError: false,
	};
}
