import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_MAX_TOKENS,
	buildModelOptionsFromConstraints,
	mergeModelConstraints,
	resolveDefaultMaxTokens,
} from "../src/model-options.ts";

describe("model option cost guardrails", () => {
	it("applies a default max token cap when an agent does not define one", () => {
		assert.equal(buildModelOptionsFromConstraints().maxTokens, DEFAULT_MAX_TOKENS);
	});

	it("keeps explicit per-agent and per-call caps", () => {
		assert.equal(buildModelOptionsFromConstraints({ max_tokens: 800 }).maxTokens, 800);
		assert.equal(buildModelOptionsFromConstraints({ maxTokens: 640 }).maxTokens, 640);
	});

	it("lets per-call constraints override manifest constraints without dropping other options", () => {
		const merged = mergeModelConstraints(
			{ temperature: 0.2, top_p: 0.8, max_tokens: 4096 },
			{ maxTokens: 512 },
		);

		assert.deepEqual(buildModelOptionsFromConstraints(merged), {
			temperature: 0.2,
			topP: 0.8,
			maxTokens: 512,
		});
	});

	it("supports an env-configured default and ignores invalid values", () => {
		assert.equal(resolveDefaultMaxTokens({ GITCLAW_DEFAULT_MAX_TOKENS: "1024" }), 1024);
		assert.equal(resolveDefaultMaxTokens({ GITCLAW_DEFAULT_MAX_TOKENS: "nope" }), DEFAULT_MAX_TOKENS);
	});
});
