import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
	assertVoiceAuthConfig,
	isSafeSkillSource,
	previewForLog,
	resolveInsideRoot,
	resolveVoiceHost,
} from "../src/voice/security.ts";

describe("voice server security helpers", () => {
	it("keeps requested file paths inside the agent root", () => {
		const root = resolve("/tmp/gitclaw-agent");

		assert.equal(resolveInsideRoot(root, "workspace/report.md"), resolve(root, "workspace/report.md"));
		assert.equal(resolveInsideRoot(root, "."), root);
		assert.equal(resolveInsideRoot(root, "../gitclaw-agent-secret/.env"), null);
		assert.equal(resolveInsideRoot(root, "/tmp/gitclaw-agent-secret/.env"), null);
	});

	it("binds voice server to loopback by default and requires auth for exposed hosts", () => {
		assert.equal(resolveVoiceHost({}), "127.0.0.1");
		assert.equal(resolveVoiceHost({ GITCLAW_HOST: "0.0.0.0" }), "0.0.0.0");

		assert.doesNotThrow(() => assertVoiceAuthConfig("127.0.0.1", false));
		assert.doesNotThrow(() => assertVoiceAuthConfig("0.0.0.0", true));
		assert.throws(
			() => assertVoiceAuthConfig("0.0.0.0", false),
			/GITCLAW_PASSWORD is required/,
		);
	});

	it("rejects skill marketplace sources that could break out into a shell command", () => {
		assert.equal(isSafeSkillSource("owner/skill-name"), true);
		assert.equal(isSafeSkillSource("owner/skill-name#v1.2.3"), true);
		assert.equal(isSafeSkillSource("owner/skill-name;rm -rf /"), false);
		assert.equal(isSafeSkillSource("https://github.com/owner/skill-name"), false);
		assert.equal(isSafeSkillSource("../owner/skill"), false);
	});

	it("redacts common key and token shapes before log previewing", () => {
		assert.equal(previewForLog("sk-abc1234567890SECRET"), "[redacted-key]");
		assert.equal(previewForLog("ghp_123456789012345678901234567890123456"), "[redacted-token]");
		assert.equal(previewForLog("call me at +14155550123"), "call me at [redacted-number]");
	});
});
