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
		assert.match(content, /--agent-dir \.\/agents\/assistant/);
		assert.match(content, /--max-tokens 2048/);
		assert.match(content, /MAX_TOKENS=2048/);
		assert.match(content, /--github-repo YOUR_USERNAME\/gitclaw-demo-agent/);
		assert.match(content, /fixture mode is regression coverage only; it is not submission proof/);
		assert.match(content, /live SDK capture plus live PR flow/);
		assert.match(content, /memory\/circuit-breaker\/sessions\/<session-id>\.jsonl/);
		assert.match(content, /memory\/circuit-breaker\/calibration\.md/);
		assert.match(content, /the submission proof must come from a real GitClaw SDK\/provider run/);
		assert.match(content, /ARCHITECTURE\.md/);
		assert.match(content, /`query\(\)` SDK stream/);
		assert.match(content, /V1 is advisory/);
		assert.doesNotMatch(content, /production-ready/i);
		assert.doesNotMatch(content, /enterprise-grade/i);
	});

	it("documents the architecture boundary and reviewer checklist", async () => {
		const content = await readFile("examples/circuit-breaker/ARCHITECTURE.md", "utf8");

		assert.match(content, /## Architecture Verdict/);
		assert.match(content, /## Component Diagram/);
		assert.match(content, /## Runtime Boundary/);
		assert.match(content, /## Key Design Decisions/);
		assert.match(content, /## Reviewer Checklist/);
		assert.match(content, /GitClaw query\(\) SDK run/);
		assert.match(content, /GCMessage stream/);
		assert.match(content, /message-adapter\.ts/);
		assert.match(content, /evidence-writer\.ts/);
		assert.match(content, /detector\.ts and cost-baseline\.ts/);
		assert.match(content, /patch-planner\.ts/);
		assert.match(content, /github-pr-writer\.ts/);
		assert.match(content, /not a custom agent runtime/);
		assert.match(content, /fixtures are regression only, not submission proof/);
		assert.match(content, /What Stays Human/);
		assert.doesNotMatch(content, /production-ready/i);
		assert.doesNotMatch(content, /enterprise-grade/i);
	});

	it("keeps PR proof live-only", async () => {
		const content = await readFile("examples/circuit-breaker/pr-proof.sh", "utf8");

		assert.match(content, /mode: live SDK capture -> real GitHub PR/);
		assert.match(content, /--agent-dir "\$\{AGENT_DIR\}"/);
		assert.match(content, /--open-pr/);
		assert.doesNotMatch(content, /LIVE_PR/);
		assert.doesNotMatch(content, /--fixture/);
		assert.match(content, /GITHUB_REPO=YOUR_USERNAME\/gitclaw-demo-agent/);
	});
});
