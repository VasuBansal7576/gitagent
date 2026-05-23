import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	computeResultDelta,
	detectToolLoop,
	extractStableResultItems,
} from "../examples/circuit-breaker/detector.ts";
import type { CircuitBreakerEvent, PersistedCircuitBreakerEvent } from "../examples/circuit-breaker/message-adapter.ts";

describe("circuit breaker result delta", () => {
	it("extracts stable ids from nested JSON result content", () => {
		const content = JSON.stringify({
			results: [
				{
					title: "GitClaw SDK",
					url: "https://EXAMPLE.com/docs?utm_source=agent&ts=123&b=2&a=1#section",
					id: "doc-123",
				},
				{
					nested: {
						path: "src/sdk-types.ts",
						sha: "abc123",
					},
				},
			],
		});

		assert.deepEqual(extractStableResultItems(content), [
			"https://example.com/docs?a=1&b=2",
			"doc-123",
			"src/sdk-types.ts",
			"abc123",
		]);
	});

	it("falls back to URLs and paths from plain text", () => {
		const content = "Read https://Example.com/a?cache_bust=1&utm_medium=x#frag, then inspect ./src/sdk.ts and /tmp/run.json.";

		assert.deepEqual(extractStableResultItems(content), [
			"https://example.com/a",
			"./src/sdk.ts",
			"/tmp/run.json",
		]);
	});

	it("computes new stable items over prior evidence", () => {
		const result = computeResultDelta({
			previousItems: ["https://example.com/a", "doc-1"],
			windowContents: [
				JSON.stringify({ results: [{ url: "https://example.com/a" }, { id: "doc-2" }] }),
				JSON.stringify({ results: [{ url: "https://example.com/b" }, { id: "doc-2" }] }),
			],
		});

		assert.deepEqual(result.windowItems, [
			"https://example.com/a",
			"doc-2",
			"https://example.com/b",
		]);
		assert.deepEqual(result.newItems, ["doc-2", "https://example.com/b"]);
		assert.equal(result.resultDelta, 2 / 3);
	});

	it("returns unknown when no stable result items can be extracted", () => {
		assert.deepEqual(computeResultDelta({ windowContents: ["nothing durable changed"] }), {
			resultDelta: "unknown",
			windowItems: [],
			newItems: [],
		});
	});
});

describe("circuit breaker tool-loop detector", () => {
	it("detects repeated paired tool calls with low result delta", () => {
		const events = persisted([
			toolUse("call-1", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-1", "search_docs", { results: [{ url: "https://example.com/a" }] }),
			toolUse("call-2", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-2", "search_docs", { results: [{ url: "https://example.com/a" }] }),
			toolUse("call-3", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-3", "search_docs", { results: [{ url: "https://example.com/a" }] }),
			toolUse("call-4", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-4", "search_docs", { results: [{ url: "https://example.com/a" }] }),
		]);

		const finding = detectToolLoop(events);

		assert.ok(finding);
		assert.equal(finding.detector, "tool-loop-v1");
		assert.equal(finding.toolName, "search_docs");
		assert.equal(finding.windowSize, 3);
		assert.deepEqual(finding.toolCallIds, ["call-2", "call-3", "call-4"]);
		assert.deepEqual(finding.eventIndexes, [2, 3, 4, 5, 6, 7]);
		assert.equal(finding.argSimilarity, 1);
		assert.equal(finding.resultDelta, 0);
		assert.equal(finding.confidence, 1);
	});

	it("does not fire when result items keep changing", () => {
		const events = persisted([
			toolUse("call-1", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-1", "search_docs", { results: [{ url: "https://example.com/a" }] }),
			toolUse("call-2", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-2", "search_docs", { results: [{ url: "https://example.com/b" }] }),
			toolUse("call-3", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-3", "search_docs", { results: [{ url: "https://example.com/c" }] }),
			toolUse("call-4", "search_docs", { query: "gitclaw sdk events" }),
			toolResult("call-4", "search_docs", { results: [{ url: "https://example.com/d" }] }),
		]);

		assert.equal(detectToolLoop(events), null);
	});

	it("does not fire without paired tool results", () => {
		const events = persisted([
			toolUse("call-1", "search_docs", { query: "gitclaw sdk events" }),
			toolUse("call-2", "search_docs", { query: "gitclaw sdk events" }),
			toolUse("call-3", "search_docs", { query: "gitclaw sdk events" }),
		]);

		assert.equal(detectToolLoop(events), null);
	});

	it("does not fire primary P0 when result delta is unknown", () => {
		const events = persisted([
			toolUse("call-1", "search_docs", { query: "gitclaw sdk events" }),
			toolResultText("call-1", "search_docs", "same text"),
			toolUse("call-2", "search_docs", { query: "gitclaw sdk events" }),
			toolResultText("call-2", "search_docs", "same text"),
			toolUse("call-3", "search_docs", { query: "gitclaw sdk events" }),
			toolResultText("call-3", "search_docs", "same text"),
			toolUse("call-4", "search_docs", { query: "gitclaw sdk events" }),
			toolResultText("call-4", "search_docs", "same text"),
		]);

		assert.equal(detectToolLoop(events), null);
	});
});

function persisted(events: CircuitBreakerEvent[]): PersistedCircuitBreakerEvent[] {
	return events.map((event, eventIndex) => ({
		sessionId: "session-test",
		eventIndex,
		observedAt: `2026-05-23T12:00:${String(eventIndex).padStart(2, "0")}.000Z`,
		event,
	}));
}

function toolUse(toolCallId: string, toolName: string, args: Record<string, unknown>): CircuitBreakerEvent {
	return {
		type: "tool_use",
		toolCallId,
		toolName,
		args,
	};
}

function toolResult(toolCallId: string, toolName: string, content: unknown): CircuitBreakerEvent {
	return toolResultText(toolCallId, toolName, JSON.stringify(content));
}

function toolResultText(toolCallId: string, toolName: string, content: string): CircuitBreakerEvent {
	return {
		type: "tool_result",
		toolCallId,
		toolName,
		content,
		isError: false,
	};
}
