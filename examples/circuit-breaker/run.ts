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

export interface CircuitBreakerRunOptions {
	fixture?: string;
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
}

interface FixtureFile {
	sessionId?: string;
	messages?: unknown[];
}

export async function runCircuitBreaker(options: CircuitBreakerRunOptions): Promise<CircuitBreakerRunSummary> {
	if (options.openPr) {
		throw new Error("--open-pr is not implemented until the live PR slice");
	}
	if (!options.fixture) {
		throw new Error("Fixture mode requires --fixture");
	}

	const fixture = await loadFixture(options.fixture);
	const sessionId = fixture.sessionId ?? sessionIdFromFixturePath(options.fixture);
	const events = normalizeFixtureMessages(fixture.messages);
	const rootDir = options.rootDir ?? process.cwd();
	const evidence = await writeSessionEvents({ rootDir, sessionId, events });
	const relativeSessionLog = `memory/circuit-breaker/sessions/${sessionId}.jsonl`;

	const finding = detectToolLoop(evidence.events);
	if (!finding) {
		return {
			sessionId,
			sessionEventLog: getSessionEventLogPath(sessionId, rootDir),
			normalizedEventCount: evidence.events.length,
			findingCount: 0,
		};
	}

	const intervention = createToolLoopIntervention({
		sessionId,
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
		sessionId,
		sessionEventLog: evidence.path,
		normalizedEventCount: evidence.events.length,
		interventionPath: written.path,
		patchPath,
		prBodyPath,
		findingCount: 1,
	};
}

function normalizeFixtureMessages(messages: unknown[]): CircuitBreakerEvent[] {
	const events: CircuitBreakerEvent[] = [];
	for (const message of messages) {
		const event = adaptGCMessage(message as GCMessage);
		if (event) events.push(event);
	}
	return events;
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
