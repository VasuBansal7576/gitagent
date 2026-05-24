import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { openGitHubPrForPatch, parseGitHubRepository, GitHubPrError } from "../examples/circuit-breaker/github-pr-writer.ts";
import type { CircuitBreakerIntervention } from "../examples/circuit-breaker/intervention-writer.ts";
import { planPatchForIntervention, renderGuardrailBlock } from "../examples/circuit-breaker/patch-planner.ts";

describe("circuit breaker GitHub PR writer", () => {
	it("creates a branch, updates the target file, and opens a PR", async () => {
		const calls: CapturedCall[] = [];
		const intervention = makeIntervention();
		const patchPlan = planPatchForIntervention(intervention);

		const result = await openGitHubPrForPatch({
			"token": "gh-test-token",
			repository: "vasu/research-agent",
			intervention,
			patchPlan,
			baseBranch: "main",
			branchName: "circuit-breaker/test-session",
			fetchImpl: mockFetch(calls),
		});

		assert.equal(result.url, "https://github.com/vasu/research-agent/pull/42");
		assert.equal(result.number, 42);
		assert.equal(result.branchName, "circuit-breaker/test-session");
		assert.equal(result.target, "RULES.md");
		assert.equal(result.alreadyOpen, false);

		assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
			"GET /repos/vasu/research-agent/git/ref/heads/main",
			"POST /repos/vasu/research-agent/git/refs",
			"GET /repos/vasu/research-agent/contents/RULES.md?ref=circuit-breaker%2Ftest-session",
			"PUT /repos/vasu/research-agent/contents/RULES.md",
			"POST /repos/vasu/research-agent/pulls",
		]);

		const branchBody = calls[1].body as Record<string, unknown>;
		assert.equal(branchBody.ref, "refs/heads/circuit-breaker/test-session");
		assert.equal(branchBody.sha, "base-sha");

		const updateBody = calls[3].body as Record<string, unknown>;
		assert.equal(updateBody.branch, "circuit-breaker/test-session");
		assert.equal(updateBody.sha, "rules-sha");
		const patchedContent = Buffer.from(String(updateBody.content), "base64").toString("utf8");
		assert.match(patchedContent, /Runaway Tool Guardrails/);
		assert.match(patchedContent, /search_docs repeats with similar arguments/);

		const prBody = calls[4].body as Record<string, unknown>;
		assert.equal(prBody.head, "circuit-breaker/test-session");
		assert.equal(prBody.base, "main");
		assert.match(String(prBody.body), /Event indexes: `2, 3, 4, 5, 6, 7`/);
		assert.match(result.patch, /--- a\/RULES\.md/);
		assert.doesNotMatch(result.patch, /--- \/dev\/null/);
		assert.equal(result.prBody, prBody.body);
	});

	it("reuses an open PR when the branch and pull request already exist", async () => {
		const calls: CapturedCall[] = [];
		const intervention = makeIntervention();
		const patchPlan = planPatchForIntervention(intervention);
		const existingContent = `# Rules\n\n${renderGuardrailBlock(intervention)}`;

		const result = await openGitHubPrForPatch({
			"token": "gh-test-token",
			repository: "vasu/research-agent",
			intervention,
			patchPlan,
			branchName: "circuit-breaker/existing",
			fetchImpl: mockFetch(calls, { branchExists: true, pullExists: true, fileContent: existingContent }),
		});

		assert.equal(result.url, "https://github.com/vasu/research-agent/pull/41");
		assert.equal(result.alreadyOpen, true);
		assert.equal(calls.some((call) => call.method === "PUT"), false);
		assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
			"GET /repos/vasu/research-agent/git/ref/heads/main",
			"POST /repos/vasu/research-agent/git/refs",
			"GET /repos/vasu/research-agent/contents/RULES.md?ref=circuit-breaker%2Fexisting",
			"POST /repos/vasu/research-agent/pulls",
			"GET /repos/vasu/research-agent/pulls?state=open&head=vasu%3Acircuit-breaker%2Fexisting&base=main",
		]);
	});

	it("validates repository and token before network writes", async () => {
		assert.deepEqual(parseGitHubRepository("owner/repo.git"), { owner: "owner", name: "repo" });
		await assert.rejects(
			() => openGitHubPrForPatch({
				token: "",
				repository: "owner/repo",
				intervention: makeIntervention(),
				patchPlan: planPatchForIntervention(makeIntervention()),
				fetchImpl: async () => new Response("{}"),
			}),
			(error: unknown) => error instanceof GitHubPrError && error.message === "GITHUB_TOKEN is required for --open-pr",
		);
		assert.throws(() => parseGitHubRepository("not-a-repo"), /OWNER\/REPO/);
	});
});

interface CapturedCall {
	method: string;
	path: string;
	body?: unknown;
}

function mockFetch(
	calls: CapturedCall[],
	options: { branchExists?: boolean; pullExists?: boolean; fileContent?: string } = {},
): typeof fetch {
	return async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, path: `${url.pathname}${url.search}`, body });

		if (method === "GET" && url.pathname.endsWith("/git/ref/heads/main")) {
			return json({ object: { sha: "base-sha" } });
		}
		if (method === "POST" && url.pathname.endsWith("/git/refs")) {
			return json(options.branchExists ? { message: "Reference already exists" } : { ref: body.ref }, options.branchExists ? 422 : 201);
		}
		if (method === "GET" && url.pathname.endsWith("/contents/RULES.md")) {
			return json({
				type: "file",
				sha: "rules-sha",
				encoding: "base64",
				content: Buffer.from(options.fileContent ?? "# Rules\n", "utf8").toString("base64"),
			});
		}
		if (method === "PUT" && url.pathname.endsWith("/contents/RULES.md")) {
			return json({ commit: { sha: "commit-sha" } });
		}
		if (method === "POST" && url.pathname.endsWith("/pulls")) {
			return json(
				options.pullExists
					? { message: "Validation Failed" }
					: { html_url: "https://github.com/vasu/research-agent/pull/42", number: 42 },
				options.pullExists ? 422 : 201,
			);
		}
		if (method === "GET" && url.pathname.endsWith("/pulls")) {
			return json([{ html_url: "https://github.com/vasu/research-agent/pull/41", number: 41 }]);
		}
		return json({ message: `unhandled ${method} ${url.pathname}${url.search}` }, 500);
	};
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function makeIntervention(): CircuitBreakerIntervention {
	return {
		id: "2026-05-23T12-30-00Z-tool-loop-v1",
		session_id: "session-abc",
		agent: "research-agent",
		model: "anthropic:claude-sonnet-4",
		rules_hash: "abc12345",
		detector: "tool-loop-v1",
		severity: "high",
		evidence: {
			session_event_log: "memory/circuit-breaker/sessions/session-abc.jsonl",
			event_indexes: [2, 3, 4, 5, 6, 7],
			tool: "search_docs",
			window_size: 3,
			arg_similarity: 1,
			result_delta: 0,
			confidence: 1,
			tool_call_ids: ["call-2", "call-3", "call-4"],
		},
		action: {
			type: "pull_request",
			status: "dry_run",
			pr_url: null,
			patch_target: "RULES.md",
		},
		human_decision: null,
		created_at: "2026-05-23T12:30:00.000Z",
	};
}
