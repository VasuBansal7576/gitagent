#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import type { GCMessage, Query } from "../../src/sdk-types.js";
import { adaptGCMessage, extractSessionIdFromGCMessage, type CircuitBreakerEvent } from "./message-adapter.ts";
import { executeCircuitBreakerRun, type CircuitBreakerRunSummary } from "./run-lifecycle.ts";

export interface CircuitBreakerRunOptions {
	fixture?: string;
	agentDir?: string;
	agentName?: string;
	model?: string;
	rulesHash?: string;
	prompt?: string;
	sessionId?: string;
	maxTokens?: number;
	noTools?: boolean;
	messageSource?: LiveMessageSource;
	dryRun?: boolean;
	openPr?: boolean;
	githubRepository?: string;
	githubToken?: string;
	baseBranch?: string;
	branchName?: string;
	fetchImpl?: typeof fetch;
	rootDir?: string;
	updateBaseline?: boolean;
}

export type { CircuitBreakerRunSummary };

type LiveMessageSource = AsyncIterable<GCMessage> & Partial<Pick<Query, "sessionId">>;

interface FixtureFile {
	sessionId?: string;
	messages?: unknown[];
}

export async function runCircuitBreaker(options: CircuitBreakerRunOptions): Promise<CircuitBreakerRunSummary> {
	if (options.fixture) {
		const fixture = await loadFixture(options.fixture);
		const sessionId = options.sessionId ?? fixture.sessionId ?? sessionIdFromFixturePath(options.fixture);
		return executeCircuitBreakerRun({
			...options,
			sessionId,
			events: normalizeMessages(fixture.messages),
		});
	}

	const source = options.messageSource ?? await createLiveMessageSource(options);
	const messages: GCMessage[] = [];
	for await (const message of source) {
		messages.push(message);
	}

	return executeCircuitBreakerRun({
		...options,
		sessionId: options.sessionId ?? inferLiveSessionId(source, messages) ?? defaultLiveSessionId(),
		events: normalizeMessages(messages),
	});
}

function normalizeMessages(messages: unknown[]): CircuitBreakerEvent[] {
	const events: CircuitBreakerEvent[] = [];
	for (const message of messages) {
		const event = adaptGCMessage(message as GCMessage);
		if (event) events.push(event);
	}
	return events;
}

async function createLiveMessageSource(options: CircuitBreakerRunOptions): Promise<LiveMessageSource> {
	if (!options.agentDir) {
		throw new Error("Live mode requires --agent-dir");
	}
	if (!options.prompt) {
		throw new Error("Live mode requires --prompt");
	}

	const { query } = await import("../../dist/exports.js");
	return query({
		dir: options.agentDir,
		prompt: options.prompt,
		sessionId: options.sessionId,
		model: options.model,
		...(options.noTools ? { replaceBuiltinTools: true, tools: [] } : {}),
		...(options.maxTokens ? { constraints: { maxTokens: options.maxTokens } } : {}),
	});
}

function inferLiveSessionId(source: LiveMessageSource, messages: GCMessage[]): string | null {
	for (const message of messages) {
		const sessionId = extractSessionIdFromGCMessage(message);
		if (sessionId) return sessionId;
	}

	if (typeof source.sessionId === "function") {
		const sessionId = source.sessionId();
		if (sessionId) return sessionId;
	}

	return null;
}

function defaultLiveSessionId(): string {
	return `live-${new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}`;
}

async function loadFixture(path: string): Promise<{ sessionId?: string; messages: unknown[] }> {
	const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (Array.isArray(raw)) {
		return { messages: raw };
	}
	if (isFixtureFile(raw) && Array.isArray(raw.messages)) {
		return { sessionId: raw.sessionId, messages: raw.messages };
	}
	throw new Error("Fixture must be an array of GCMessage objects or an object with messages");
}

function isFixtureFile(value: unknown): value is FixtureFile {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdFromFixturePath(path: string): string {
	return basename(path).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "-");
}

function parseArgs(argv: string[]): CircuitBreakerRunOptions {
	const options: CircuitBreakerRunOptions = {};
	let index = 0;
	const getValue = (argName: string): string => {
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for argument: ${argName}`);
		}
		index += 1;
		return value;
	};

	for (; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--fixture":
				options.fixture = getValue(arg);
				break;
			case "--agent-dir":
				options.agentDir = getValue(arg);
				break;
			case "--agent-name":
				options.agentName = getValue(arg);
				break;
			case "--model":
				options.model = getValue(arg);
				break;
			case "--rules-hash":
				options.rulesHash = getValue(arg);
				break;
			case "--prompt":
				options.prompt = getValue(arg);
				break;
			case "--session-id":
				options.sessionId = getValue(arg);
				break;
			case "--max-tokens":
				options.maxTokens = parsePositiveInteger(getValue(arg), "--max-tokens");
				break;
			case "--no-tools":
				options.noTools = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--open-pr":
				options.openPr = true;
				break;
			case "--github-repo":
				options.githubRepository = getValue(arg);
				break;
			case "--base-branch":
				options.baseBranch = getValue(arg);
				break;
			case "--branch-name":
				options.branchName = getValue(arg);
				break;
			case "--root-dir":
				options.rootDir = getValue(arg);
				break;
			case "--update-baseline":
				options.updateBaseline = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function parsePositiveInteger(raw: string | undefined, flag: string): number {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	runCircuitBreaker(parseArgs(process.argv.slice(2)))
		.then((summary) => {
			console.log(JSON.stringify(summary, null, 2));
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
