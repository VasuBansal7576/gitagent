#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import type { GCMessage } from "../../src/sdk-types.js";
import { adaptGCMessage, type CircuitBreakerEvent } from "./message-adapter.ts";
import { getSessionEventLogPath, writeSessionEvents } from "./evidence-writer.ts";
import { detectToolLoop } from "./detector.ts";
import { createToolLoopIntervention, writeInterventionRecord } from "./intervention-writer.ts";
import { planPatchForIntervention } from "./patch-planner.ts";
import { analyzeCostAndUpdateBaseline, type CostClassification } from "./cost-baseline.ts";

export interface CircuitBreakerRunOptions {
	fixture?: string;
	agentDir?: string;
	prompt?: string;
	sessionId?: string;
	messageSource?: AsyncIterable<GCMessage>;
	dryRun?: boolean;
	openPr?: boolean;
	rootDir?: string;
}

export interface CircuitBreakerRunSummary {
	sessionId: string;
	sessionEventLog: string;
	normalizedEventCount: number;
	interventionPath?: string;
	patchPath?: string;
	prBodyPath?: string;
	findingCount: number;
	costClassification?: CostClassification;
	costBaselinePath?: string;
}

interface FixtureFile {
	sessionId?: string;
	messages?: unknown[];
}

export async function runCircuitBreaker(options: CircuitBreakerRunOptions): Promise<CircuitBreakerRunSummary> {
	if (options.openPr) {
		throw new Error("--open-pr is not implemented until the live PR slice");
	}

	if (options.fixture) {
		const fixture = await loadFixture(options.fixture);
		const sessionId = options.sessionId ?? fixture.sessionId ?? sessionIdFromFixturePath(options.fixture);
		return runNormalizedEvents({
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

	return runNormalizedEvents({
		...options,
		sessionId: options.sessionId ?? `live-${new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}`,
		events: normalizeMessages(messages),
	});
}

async function runNormalizedEvents(
	options: CircuitBreakerRunOptions & { sessionId: string; events: CircuitBreakerEvent[] },
): Promise<CircuitBreakerRunSummary> {
	const rootDir = options.rootDir ?? process.cwd();
	const evidence = await writeSessionEvents({ rootDir, sessionId: options.sessionId, events: options.events });
	const relativeSessionLog = `memory/circuit-breaker/sessions/${options.sessionId}.jsonl`;
	const costAnalysis = await analyzeCostIfPresent(rootDir, options.events);

	const finding = detectToolLoop(evidence.events);
	if (!finding) {
		return {
			sessionId: options.sessionId,
			sessionEventLog: getSessionEventLogPath(options.sessionId, rootDir),
			normalizedEventCount: evidence.events.length,
			findingCount: 0,
			costClassification: costAnalysis?.classification,
			costBaselinePath: costAnalysis?.path,
		};
	}

	const intervention = createToolLoopIntervention({
		sessionId: options.sessionId,
		sessionEventLog: relativeSessionLog,
		finding,
		status: options.dryRun === false ? "opened_pr" : "dry_run",
	});
	const written = await writeInterventionRecord({ rootDir, intervention });
	const patchPlan = planPatchForIntervention(intervention);
	const patchPath = `${written.path}.patch.diff`;
	const prBodyPath = `${written.path}.pr.md`;
	await writeFile(patchPath, patchPlan.patch, "utf8");
	await writeFile(prBodyPath, patchPlan.prBody, "utf8");

	return {
		sessionId: options.sessionId,
		sessionEventLog: evidence.path,
		normalizedEventCount: evidence.events.length,
		interventionPath: written.path,
		patchPath,
		prBodyPath,
		findingCount: 1,
		costClassification: costAnalysis?.classification,
		costBaselinePath: costAnalysis?.path,
	};
}

async function analyzeCostIfPresent(rootDir: string, events: CircuitBreakerEvent[]) {
	const assistantUsageEvents = events.filter((event) => event.type === "assistant_usage");
	const totalCost = assistantUsageEvents.reduce((sum, event) => sum + event.costUsd, 0);
	if (totalCost <= 0 || assistantUsageEvents.length === 0) return null;

	const first = assistantUsageEvents[0];
	return analyzeCostAndUpdateBaseline(rootDir, {
		agentName: "unknown",
		model: `${first.provider}:${first.model}`,
		rulesHash: "unknown",
		costUsd: totalCost,
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

async function createLiveMessageSource(options: CircuitBreakerRunOptions): Promise<AsyncIterable<GCMessage>> {
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
	});
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
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--fixture":
				options.fixture = argv[++index];
				break;
			case "--agent-dir":
				options.agentDir = argv[++index];
				break;
			case "--prompt":
				options.prompt = argv[++index];
				break;
			case "--session-id":
				options.sessionId = argv[++index];
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--open-pr":
				options.openPr = true;
				break;
			case "--root-dir":
				options.rootDir = argv[++index];
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
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
