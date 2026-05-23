import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	computeResultDelta,
	extractStableResultItems,
} from "../examples/circuit-breaker/detector.ts";

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
