import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CircuitBreakerEventSchemaError } from "../examples/circuit-breaker/message-adapter.ts";
import { runCircuitBreaker } from "../examples/circuit-breaker/run.ts";
import { analyzeCostAndUpdateBaseline } from "../examples/circuit-breaker/cost-baseline.ts";
import type { GCMessage } from "../src/sdk-types.ts";

const TEST_GITHUB_AUTH = "unit-test-auth";
const execFileAsync = promisify(execFile);

describe("circuit breaker fixture runner", () => {
	it("writes evidence, intervention, patch, and PR body for the loop fixture", async () => {
		const rootDir = await tempRoot();
		const summary = await runCircuitBreaker({
			rootDir,
			fixture: "examples/circuit-breaker/fixtures/search-loop-session.json",
			dryRun: true,
		});

		assert.equal(summary.sessionId, "search-loop-session");
		assert.equal(summary.findingCount, 1);
		assert.equal(summary.normalizedEventCount, 9);
		assert.ok(summary.interventionPath);
		assert.ok(summary.patchPath);
		assert.ok(summary.prBodyPath);
		assert.ok(summary.calibrationPath);

		await access(summary.sessionEventLog);
		await access(summary.interventionPath);
		await access(summary.patchPath);
		await access(summary.prBodyPath);
		await access(summary.calibrationPath);

		const prBody = await readFile(summary.prBodyPath, "utf8");
		assert.match(prBody, /Event indexes: `3, 4, 5, 6, 7, 8`/);
		assert.match(prBody, /search_docs/);
	});

	it("writes evidence but no intervention for normal and cost fixtures", async () => {
		for (const fixture of [
			"examples/circuit-breaker/fixtures/normal-session.json",
			"examples/circuit-breaker/fixtures/cost-spike-session.json",
		]) {
			const rootDir = await tempRoot();
			const summary = await runCircuitBreaker({ rootDir, fixture, dryRun: true });
			assert.equal(summary.findingCount, 0);
			assert.equal(summary.interventionPath, undefined);
			await access(summary.sessionEventLog);
			assert.ok(summary.calibrationPath);
			await access(summary.calibrationPath);
			if (fixture.includes("cost-spike")) {
				assert.equal(summary.costClassification?.type, "absolute_budget_warning");
				assert.ok(summary.costBaselinePath);
				await access(summary.costBaselinePath);
			}
		}
	});

	it("fails loudly for malformed fixtures", async () => {
		const rootDir = await tempRoot();
		await assert.rejects(
			() => runCircuitBreaker({
				rootDir,
				fixture: "examples/circuit-breaker/fixtures/malformed-session.json",
				dryRun: true,
			}),
			(error: unknown) =>
				error instanceof CircuitBreakerEventSchemaError &&
				error.message === "tool_use.toolCallId must be a non-empty string",
		);

		await assert.rejects(
			() => access(join(rootDir, "memory", "circuit-breaker", "sessions", "malformed-session.jsonl")),
			(error: unknown) => isMissingFile(error),
		);
	});

	it("writes a cost anomaly intervention only after enough baseline samples exist", async () => {
		const rootDir = await tempRoot();
		for (let index = 0; index < 5; index += 1) {
			await analyzeCostAndUpdateBaseline(rootDir, {
				agentName: "unknown",
				model: "anthropic:claude-sonnet-4-20250514",
				rulesHash: "unknown",
				costUsd: 0.2,
				observedAt: `2026-05-23T12:00:0${index}.000Z`,
			}, {
				updateBaseline: true,
			});
		}

		const summary = await runCircuitBreaker({
			rootDir,
			fixture: "examples/circuit-breaker/fixtures/cost-spike-session.json",
			dryRun: true,
		});

		assert.equal(summary.findingCount, 1);
		assert.equal(summary.costClassification?.type, "cost_anomaly");
		assert.ok(summary.interventionPath);
		assert.ok(summary.patchPath);
		assert.ok(summary.prBodyPath);

		const patch = await readFile(summary.patchPath, "utf8");
		const prBody = await readFile(summary.prBodyPath, "utf8");
		assert.match(patch, /--- \/dev\/null/);
		assert.match(patch, /\+## Cost Guardrails/);
		assert.match(prBody, /cost-spike-v1/);
		assert.match(prBody, /Actual cost: `\$2\.5000`/);
		assert.ok(summary.costQuarantinePath);
		await access(summary.costQuarantinePath);
	});

	it("captures an injected live SDK message source through the same dry-run path", async () => {
		const rootDir = await tempRoot();
		const summary = await runCircuitBreaker({
			rootDir,
			sessionId: "live-test-session",
			messageSource: liveLoopMessages(),
			dryRun: true,
		});

		assert.equal(summary.sessionId, "live-test-session");
		assert.equal(summary.findingCount, 1);
		assert.equal(summary.normalizedEventCount, 8);
		assert.ok(summary.interventionPath);
		assert.ok(summary.calibrationPath);
		await access(summary.sessionEventLog);
		await access(summary.interventionPath);
		await access(summary.calibrationPath);
	});

	it("preserves the SDK session id for live captures when --session-id is omitted", async () => {
		const rootDir = await tempRoot();
		const summary = await runCircuitBreaker({
			rootDir,
			messageSource: liveLoopMessagesWithSdkSessionId("sdk-session-42"),
			dryRun: true,
		});

		assert.equal(summary.sessionId, "sdk-session-42");
		assert.match(summary.sessionEventLog, /sdk-session-42\.jsonl$/);
	});

	it("opens a GitHub PR after local dry-run artifacts are written", async () => {
		const rootDir = await tempRoot();
		const calls: CapturedGitHubCall[] = [];
		const summary = await runCircuitBreaker({
			rootDir,
			fixture: "examples/circuit-breaker/fixtures/search-loop-session.json",
			openPr: true,
			githubRepository: "vasu/research-agent",
			githubToken: TEST_GITHUB_AUTH,
			branchName: "circuit-breaker/search-loop-session",
			fetchImpl: githubFetch(calls),
		});

		assert.equal(summary.findingCount, 1);
		assert.equal(summary.githubPr?.url, "https://github.com/vasu/research-agent/pull/42");
		assert.ok(summary.interventionPath);
		assert.ok(summary.patchPath);
		assert.ok(summary.prBodyPath);
		assert.ok(summary.calibrationPath);
		await access(summary.patchPath);
		await access(summary.prBodyPath);
		await access(summary.calibrationPath);

		const interventionYaml = await readFile(summary.interventionPath, "utf8");
		assert.match(interventionYaml, /status: opened_pr/);
		assert.match(interventionYaml, /pr_url: https:\/\/github\.com\/vasu\/research-agent\/pull\/42/);

		const pullCall = calls.find((call) => call.method === "POST" && call.path.endsWith("/pulls"));
		assert.ok(pullCall);
		const localPatch = await readFile(summary.patchPath, "utf8");
		const localPrBody = await readFile(summary.prBodyPath, "utf8");
		assert.match(localPatch, /--- a\/RULES\.md/);
		assert.equal(localPrBody, (pullCall.body as Record<string, unknown>).body);
	});

	it("blocks live PR mode before network writes when local artifact preflight fails", async () => {
		const rootDir = await tempRoot();
		const interventionsDir = join(rootDir, "memory", "circuit-breaker", "interventions");
		await mkdir(interventionsDir, { recursive: true });
		await writeFile(
			join(interventionsDir, "stale.yaml"),
			[
				"id: stale",
				"session_id: search-loop-session",
				"evidence:",
				"  session_event_log: memory/circuit-breaker/sessions/search-loop-session.jsonl",
				"  event_indexes: [0]",
				"",
			].join("\n"),
			"utf8",
		);
		const calls: string[] = [];

		await assert.rejects(
			() => runCircuitBreaker({
				rootDir,
				fixture: "examples/circuit-breaker/fixtures/search-loop-session.json",
				openPr: true,
				githubRepository: "vasu/research-agent",
				githubToken: TEST_GITHUB_AUTH,
				fetchImpl: async (input) => {
					calls.push(String(input));
					return json({});
				},
			}),
			/stale\.yaml\.patch\.diff/,
		);

		assert.deepEqual(calls, []);
	});

	it("refuses PR mode when a real run produces no intervention", async () => {
		const rootDir = await tempRoot();

		await assert.rejects(
			() => runCircuitBreaker({
				rootDir,
				fixture: "examples/circuit-breaker/fixtures/normal-session.json",
				openPr: true,
				githubRepository: "vasu/research-agent",
				githubToken: TEST_GITHUB_AUTH,
			}),
			/--open-pr requires a detected intervention/,
		);
	});

	it("fails loudly when a CLI option is missing its value", async () => {
		await assert.rejects(
			() => execFileAsync(process.execPath, [
				"--experimental-strip-types",
				"examples/circuit-breaker/run.ts",
				"--fixture",
				"--dry-run",
			]),
			(error: unknown) => {
				const cliError = error as { stderr?: string; code?: number };
				assert.equal(cliError.code, 1);
				assert.match(cliError.stderr ?? "", /Missing value for argument: --fixture/);
				return true;
			},
		);
	});
});

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gitclaw-cb-run-"));
}

async function* liveLoopMessages(): AsyncIterable<GCMessage> {
	for (const message of [
		toolUse("live-1"),
		toolResult("live-1"),
		toolUse("live-2"),
		toolResult("live-2"),
		toolUse("live-3"),
		toolResult("live-3"),
		toolUse("live-4"),
		toolResult("live-4"),
	]) {
		yield message;
	}
}

function liveLoopMessagesWithSdkSessionId(sessionId: string): AsyncIterable<GCMessage> & { sessionId(): string } {
	return Object.assign(liveLoopMessages(), {
		sessionId: () => sessionId,
	});
}

function toolUse(toolCallId: string): GCMessage {
	return {
		type: "tool_use",
		toolCallId,
		toolName: "search_docs",
		args: { query: "gitclaw sdk events" },
	};
}

function toolResult(toolCallId: string): GCMessage {
	return {
		type: "tool_result",
		toolCallId,
		toolName: "search_docs",
		content: "{\"results\":[{\"url\":\"https://example.com/a\"}]}",
		isError: false,
	};
}

interface CapturedGitHubCall {
	method: string;
	path: string;
	body?: unknown;
}

function githubFetch(calls: CapturedGitHubCall[] = []): typeof fetch {
	return async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, path: `${url.pathname}${url.search}`, body });
		if (method === "GET" && url.pathname.endsWith("/git/ref/heads/main")) {
			return json({ object: { sha: "base-sha" } });
		}
		if (method === "POST" && url.pathname.endsWith("/git/refs")) {
			return json({ ref: "refs/heads/circuit-breaker/search-loop-session" }, 201);
		}
		if (method === "GET" && url.pathname.endsWith("/contents/RULES.md")) {
			return json({
				type: "file",
				sha: "rules-sha",
				encoding: "base64",
				content: Buffer.from("# Rules\n", "utf8").toString("base64"),
			});
		}
		if (method === "PUT" && url.pathname.endsWith("/contents/RULES.md")) {
			return json({ commit: { sha: "commit-sha" } });
		}
		if (method === "POST" && url.pathname.endsWith("/pulls")) {
			return json({ html_url: "https://github.com/vasu/research-agent/pull/42", number: 42 }, 201);
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

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
