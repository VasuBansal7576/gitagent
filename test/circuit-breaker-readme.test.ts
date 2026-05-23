import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("circuit breaker README", () => {
	it("documents commands, artifacts, and trust boundary", async () => {
		const content = await readFile("examples/circuit-breaker/README.md", "utf8");

		assert.match(content, /## Fixture Mode/);
		assert.match(content, /## Live Dry-Run Mode/);
		assert.match(content, /## Live PR Mode/);
		assert.match(content, /examples\/circuit-breaker\/demo\.sh/);
		assert.match(content, /--fixture examples\/circuit-breaker\/fixtures\/search-loop-session\.json/);
		assert.match(content, /--agent-dir \.\/agents\/research-agent/);
		assert.match(content, /--github-repo YOUR_USERNAME\/research-agent/);
		assert.match(content, /memory\/circuit-breaker\/sessions\/<session-id>\.jsonl/);
		assert.match(content, /memory\/circuit-breaker\/calibration\.md/);
		assert.match(content, /V1 is advisory/);
		assert.doesNotMatch(content, /production-ready/i);
		assert.doesNotMatch(content, /enterprise-grade/i);
	});
});
