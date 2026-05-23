import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("circuit breaker skill", () => {
	it("has GitClaw skill frontmatter and a native contract", async () => {
		const content = await readFile("skills/circuit-breaker/SKILL.md", "utf8");

		assert.match(content, /^---\nname: circuit-breaker\n/m);
		assert.match(content, /description: Analyze GitClaw SDK events/);
		assert.match(content, /A GitClaw `GCMessage` stream or captured session JSONL/);
		assert.match(content, /Do not run a second agent runtime/);
		assert.match(content, /Cite exact session event indexes/);
	});
});
