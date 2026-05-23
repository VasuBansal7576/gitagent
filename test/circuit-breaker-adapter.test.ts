import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { GCMessage } from "../src/sdk-types.js";
import {
	CircuitBreakerEventSchemaError,
	adaptGCMessage,
	type CircuitBreakerEvent,
	type PersistedCircuitBreakerEvent,
} from "../examples/circuit-breaker/message-adapter.ts";

async function readJsonFixture(path: string): Promise<unknown> {
	const content = await readFile(new URL(path, import.meta.url), "utf8");
	return JSON.parse(content);
}

describe("circuit breaker message adapter", () => {
	it("preserves assistant usage, tool use, and tool result fields", async () => {
		const raw = await readJsonFixture("../examples/circuit-breaker/fixtures/adapter-valid-messages.json");
		assert.ok(Array.isArray(raw));

		const messages = raw as GCMessage[];
		const events = messages
			.map((message) => adaptGCMessage(message))
			.filter((event): event is CircuitBreakerEvent => event !== null);

		assert.deepEqual(events, [
			{
				type: "assistant_usage",
				model: "claude-sonnet-4-20250514",
				provider: "anthropic",
				inputTokens: 120,
				outputTokens: 44,
				totalTokens: 164,
				costUsd: 0.00102,
				stopReason: "toolUse",
			},
			{
				type: "tool_use",
				toolCallId: "toolu_01",
				toolName: "search_docs",
				args: {
					query: "gitclaw sdk message stream",
					limit: 5,
				},
			},
			{
				type: "tool_result",
				toolCallId: "toolu_01",
				toolName: "search_docs",
				content: "{\"results\":[{\"url\":\"https://example.com/gitclaw-sdk\"}]}",
				isError: false,
			},
		]);
	});

	it("ignores GCMessage types that are not detector inputs", () => {
		assert.equal(adaptGCMessage({ type: "user", content: "hello" }), null);
		assert.equal(adaptGCMessage({ type: "delta", deltaType: "text", content: "stream" }), null);
		assert.equal(adaptGCMessage({ type: "system", subtype: "session_start", content: "start" }), null);
	});

	it("fails loudly when required SDK fields are missing", async () => {
		const raw = await readJsonFixture("../examples/circuit-breaker/fixtures/malformed-session.json");
		assert.ok(Array.isArray(raw));

		assert.throws(
			() => adaptGCMessage(raw[0] as GCMessage),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "tool_use.toolCallId must be a non-empty string",
		);

		assert.throws(
			() => adaptGCMessage(raw[1] as GCMessage),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "assistant.usage must be an object",
		);
	});

	it("fails loudly for non-object or unknown SDK messages", () => {
		assert.throws(
			() => adaptGCMessage(null as unknown as GCMessage),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "GCMessage must be an object",
		);

		assert.throws(
			() => adaptGCMessage({ type: "mystery" } as unknown as GCMessage),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "Unsupported GCMessage type: mystery",
		);
	});

	it("exposes a persisted event type for evidence records", () => {
		const event: PersistedCircuitBreakerEvent = {
			sessionId: "session-1",
			eventIndex: 0,
			observedAt: "2026-05-23T12:00:00.000Z",
			event: {
				type: "tool_use",
				toolCallId: "toolu_01",
				toolName: "search_docs",
				args: { query: "gitclaw" },
			},
		};

		assert.equal(event.event.type, "tool_use");
		assert.equal(event.event.toolCallId, "toolu_01");
	});
});
