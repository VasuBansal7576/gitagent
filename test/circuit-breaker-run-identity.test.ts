import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRunIdentity } from "../examples/circuit-breaker/run-identity.ts";
import type { CircuitBreakerEvent } from "../examples/circuit-breaker/message-adapter.ts";

describe("circuit breaker run identity", () => {
	it("derives agent name, model, and rules hash from the run context", async () => {
		const root = await mkdtemp(join(tmpdir(), "gitclaw-agent-"));
		const agentDir = join(root, "research-agent");
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "RULES.md"), "# Rules\n- Stop on repeated no-progress tool calls.\n", "utf8");

		const identity = await resolveRunIdentity({
			agentDir,
			events: [assistantUsage()],
		});

		assert.equal(identity.agentName, "research-agent");
		assert.equal(identity.model, "anthropic:claude-sonnet-4-20250514");
		assert.match(identity.rulesHash, /^[a-f0-9]{8}$/);
	});

	it("lets explicit run identity override inferred values", async () => {
		const identity = await resolveRunIdentity({
			agentDir: "/tmp/ignored-agent",
			agentName: "production-research",
			rulesHash: "abc12345",
			events: [],
		});

		assert.deepEqual(identity, {
			agentName: "production-research",
			model: "unknown",
			rulesHash: "abc12345",
		});
	});
});

function assistantUsage(): CircuitBreakerEvent {
	return {
		type: "assistant_usage",
		model: "claude-sonnet-4-20250514",
		provider: "anthropic",
		inputTokens: 100,
		outputTokens: 50,
		totalTokens: 150,
		costUsd: 0.01,
		stopReason: "stop",
	};
}
