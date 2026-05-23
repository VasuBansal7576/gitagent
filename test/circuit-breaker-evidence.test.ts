import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CircuitBreakerEvent } from "../examples/circuit-breaker/message-adapter.ts";
import {
	getSessionEventLogPath,
	readSessionEvents,
	writeSessionEvents,
} from "../examples/circuit-breaker/evidence-writer.ts";

describe("circuit breaker evidence writer", () => {
	it("writes normalized events to session JSONL with stable indexes", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "gitclaw-cb-"));
		const events: CircuitBreakerEvent[] = [
			{
				type: "tool_use",
				toolCallId: "toolu_1",
				toolName: "search_docs",
				args: { query: "gitclaw" },
			},
			{
				type: "tool_result",
				toolCallId: "toolu_1",
				toolName: "search_docs",
				content: "{\"results\":[]}",
				isError: false,
			},
		];

		const result = await writeSessionEvents({
			rootDir,
			sessionId: "session-abc",
			events,
			observedAt: (_event, index) => `2026-05-23T12:00:0${index}.000Z`,
		});

		assert.equal(result.path, getSessionEventLogPath("session-abc", rootDir));
		assert.deepEqual(result.events.map((event) => event.eventIndex), [0, 1]);
		assert.deepEqual(result.events.map((event) => event.observedAt), [
			"2026-05-23T12:00:00.000Z",
			"2026-05-23T12:00:01.000Z",
		]);

		const replayed = await readSessionEvents(result.path);
		assert.deepEqual(replayed, result.events);
		assert.deepEqual(replayed.map((event) => event.event.toolCallId), ["toolu_1", "toolu_1"]);
	});

	it("rejects unsafe session ids before building a path", async () => {
		await assert.rejects(
			() => writeSessionEvents({ sessionId: "../escape", events: [] }),
			/sessionId must contain only/,
		);
	});

	it("fails loudly on malformed JSONL evidence", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "gitclaw-cb-"));
		const path = join(rootDir, "bad.jsonl");
		await writeFile(path, "{\"sessionId\":\"missing-event\"}\n", "utf8");

		await assert.rejects(
			() => readSessionEvents(path),
			/Invalid circuit breaker event shape at line 1/,
		);
	});
});
