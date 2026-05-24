#!/usr/bin/env node
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

export interface VerifyArtifactOptions {
	rootDir?: string;
	sessionId?: string;
	expectInterventions?: number;
	requirePatch?: boolean;
	requirePrBody?: boolean;
	requireCalibration?: boolean;
}

export interface ArtifactVerificationSummary {
	rootDir: string;
	sessionCount: number;
	interventionCount: number;
	calibrationPath?: string;
	checkedSessionIds: string[];
	checkedInterventionIds: string[];
}

interface PersistedEventShape {
	sessionId: string;
	eventIndex: number;
	observedAt: string;
	event: unknown;
}

interface InterventionShape {
	id: string;
	session_id: string;
	evidence?: {
		session_event_log?: string;
		event_indexes?: number[];
	};
}

export async function verifyCircuitBreakerArtifacts(
	options: VerifyArtifactOptions = {},
): Promise<ArtifactVerificationSummary> {
	const rootDir = options.rootDir ?? process.cwd();
	const memoryDir = join(rootDir, "memory", "circuit-breaker");
	const sessionsDir = join(memoryDir, "sessions");
	const interventionsDir = join(memoryDir, "interventions");
	const calibrationPath = join(memoryDir, "calibration.md");

	const sessionFiles = await listFiles(sessionsDir, ".jsonl");
	const targetSessionFiles = options.sessionId
		? [`${options.sessionId}.jsonl`]
		: sessionFiles;

	if (targetSessionFiles.length === 0) {
		throw new Error(`No session JSONL files found under ${sessionsDir}`);
	}

	const sessions = new Map<string, PersistedEventShape[]>();
	for (const file of targetSessionFiles) {
		const sessionId = file.replace(/\.jsonl$/, "");
		const events = await readSessionJsonl(join(sessionsDir, file), sessionId);
		sessions.set(sessionId, events);
	}

	const interventionFiles = await listFiles(interventionsDir, ".yaml");
	const interventions: InterventionShape[] = [];
	for (const file of interventionFiles) {
		const path = join(interventionsDir, file);
		const intervention = YAML.parse(await readFile(path, "utf8")) as InterventionShape;
		if (options.sessionId && intervention.session_id !== options.sessionId) continue;
		validateIntervention(intervention, sessions);
		if (options.requirePatch) await validatePatchArtifact(`${path}.patch.diff`);
		if (options.requirePrBody) await access(`${path}.pr.md`);
		interventions.push(intervention);
	}

	if (options.expectInterventions !== undefined && interventions.length !== options.expectInterventions) {
		throw new Error(`Expected ${options.expectInterventions} intervention(s), found ${interventions.length}`);
	}

	if (options.requireCalibration) {
		await access(calibrationPath);
	}

	return {
		rootDir,
		sessionCount: sessions.size,
		interventionCount: interventions.length,
		calibrationPath: options.requireCalibration ? calibrationPath : undefined,
		checkedSessionIds: [...sessions.keys()],
		checkedInterventionIds: interventions.map((intervention) => intervention.id),
	};
}

async function readSessionJsonl(path: string, expectedSessionId: string): Promise<PersistedEventShape[]> {
	const content = await readFile(path, "utf8");
	const lines = content.trim().length === 0 ? [] : content.trimEnd().split("\n");
	if (lines.length === 0) throw new Error(`Session JSONL is empty: ${path}`);

	return lines.map((line, index) => {
		let event: PersistedEventShape;
		try {
			event = JSON.parse(line) as PersistedEventShape;
		} catch (error) {
			throw new Error(`Invalid JSON in session JSONL ${path} at line ${index + 1}: ${(error as Error).message}`);
		}
		if (event.sessionId !== expectedSessionId) {
			throw new Error(`Session id mismatch in ${path}: expected ${expectedSessionId}, got ${event.sessionId}`);
		}
		if (event.eventIndex !== index) {
			throw new Error(`Event index mismatch in ${path}: expected ${index}, got ${event.eventIndex}`);
		}
		if (typeof event.observedAt !== "string" || !event.observedAt) {
			throw new Error(`Missing observedAt for event ${index} in ${path}`);
		}
		return event;
	});
}

function validateIntervention(intervention: InterventionShape, sessions: Map<string, PersistedEventShape[]>): void {
	if (!intervention.id) throw new Error("Intervention is missing id");
	if (!intervention.session_id) throw new Error(`Intervention ${intervention.id} is missing session_id`);
	const sessionEventLog = intervention.evidence?.session_event_log;
	if (sessionEventLog && !sessionEventLog.endsWith(`/${intervention.session_id}.jsonl`)) {
		throw new Error(
			`Intervention ${intervention.id} session_event_log ${sessionEventLog} does not match session_id ${intervention.session_id}`,
		);
	}
	const session = sessions.get(intervention.session_id);
	if (!session) return;

	const indexes = intervention.evidence?.event_indexes ?? [];
	for (const eventIndex of indexes) {
		if (!session.some((event) => event.eventIndex === eventIndex)) {
			throw new Error(`Intervention ${intervention.id} cites missing eventIndex ${eventIndex}`);
		}
	}
}

async function validatePatchArtifact(path: string): Promise<void> {
	const patch = await readFile(path, "utf8");
	if (!/^--- (?:a\/|\/dev\/null)/m.test(patch) || !/^\+\+\+ b\//m.test(patch) || !/^@@ /m.test(patch)) {
		throw new Error(`${path} is not a unified diff`);
	}
}

async function listFiles(dir: string, suffix: string): Promise<string[]> {
	try {
		return (await readdir(dir))
			.filter((file) => file.endsWith(suffix))
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function parseArgs(argv: string[]): VerifyArtifactOptions {
	const options: VerifyArtifactOptions = {};
	const getValue = (index: number, argName: string): string => {
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for argument: ${argName}`);
		return value;
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--root-dir":
				options.rootDir = getValue(index, arg);
				index += 1;
				break;
			case "--session-id":
				options.sessionId = getValue(index, arg);
				index += 1;
				break;
			case "--expect-interventions":
				options.expectInterventions = parseNonNegativeInteger(getValue(index, arg), arg);
				index += 1;
				break;
			case "--require-patch":
				options.requirePatch = true;
				break;
			case "--require-pr-body":
				options.requirePrBody = true;
				break;
			case "--require-calibration":
				options.requireCalibration = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function parseNonNegativeInteger(raw: string, flag: string): number {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer`);
	}
	return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	verifyCircuitBreakerArtifacts(parseArgs(process.argv.slice(2)))
		.then((summary) => {
			console.log(JSON.stringify(summary, null, 2));
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
