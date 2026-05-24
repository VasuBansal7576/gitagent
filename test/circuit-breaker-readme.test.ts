import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("circuit breaker README", () => {
	it("documents commands, artifacts, and trust boundary", async () => {
		const content = await readFile("examples/circuit-breaker/README.md", "utf8");

			assert.match(content, /## Fixture Mode/);
			assert.match(content, /## Start Here/);
			assert.match(content, /## Live Dry-Run Mode/);
			assert.match(content, /## Live PR Mode/);
			assert.match(content, /examples\/circuit-breaker\/demo\.sh/);
			assert.match(content, /examples\/circuit-breaker\/live-proof\.sh/);
			assert.match(content, /examples\/circuit-breaker\/pr-proof\.sh/);
			assert.match(content, /verify-artifacts\.ts/);
			assert.match(content, /--fixture examples\/circuit-breaker\/fixtures\/search-loop-session\.json/);
			assert.match(content, /--agent-dir \.\/agents\/research-agent/);
			assert.match(content, /--max-tokens 2048/);
			assert.match(content, /MAX_TOKENS=2048/);
			assert.match(content, /--github-repo YOUR_USERNAME\/research-agent/);
			assert.match(content, /memory\/circuit-breaker\/sessions\/<session-id>\.jsonl/);
			assert.match(content, /memory\/circuit-breaker\/calibration\.md/);
			assert.match(content, /Cost anomaly is included, but v1's strongest proof is deterministic loop detection/);
			assert.match(content, /`query\(\)` SDK stream/);
			assert.match(content, /V1 is advisory/);
			assert.doesNotMatch(content, /production-ready/i);
			assert.doesNotMatch(content, /enterprise-grade/i);
	});
});
