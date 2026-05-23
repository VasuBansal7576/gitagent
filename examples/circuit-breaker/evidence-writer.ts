import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CircuitBreakerEvent, PersistedCircuitBreakerEvent } from "./message-adapter.js";

export interface WriteSessionEventsOptions {
	sessionId: string;
	events: CircuitBreakerEvent[];
	rootDir?: string;
	observedAt?: string | ((event: CircuitBreakerEvent, eventIndex: number) => string);
}

export interface WriteSessionEventsResult {
	sessionId: string;
	path: string;
	events: PersistedCircuitBreakerEvent[];
}

export async function writeSessionEvents(options: WriteSessionEventsOptions): Promise<WriteSessionEventsResult> {
	const sessionId = normalizeSessionId(options.sessionId);
	const sessionsDir = getSessionsDir(options.rootDir);
	await mkdir(sessionsDir, { recursive: true });

	const persisted = options.events.map((event, eventIndex) => ({
		sessionId,
		eventIndex,
		observedAt: observedAtFor(options.observedAt, event, eventIndex),
		event,
	}));

	const path = getSessionEventLogPath(sessionId, options.rootDir);
	const content = persisted.map((event) => JSON.stringify(event)).join("\n") + (persisted.length > 0 ? "\n" : "");
	await writeFile(path, content, "utf8");

	return { sessionId, path, events: persisted };
}

export async function readSessionEvents(path: string): Promise<PersistedCircuitBreakerEvent[]> {
	const content = await readFile(path, "utf8");
	if (content.trim().length === 0) return [];

	return content
		.trimEnd()
		.split("\n")
		.map((line, lineIndex) => parsePersistedEvent(line, lineIndex));
}

export function getSessionEventLogPath(sessionId: string, rootDir = process.cwd()): string {
	return join(getSessionsDir(rootDir), `${normalizeSessionId(sessionId)}.jsonl`);
}

function getSessionsDir(rootDir = process.cwd()): string {
	return join(rootDir, "memory", "circuit-breaker", "sessions");
}

function observedAtFor(
	observedAt: WriteSessionEventsOptions["observedAt"],
	event: CircuitBreakerEvent,
	eventIndex: number,
): string {
	if (typeof observedAt === "function") return observedAt(event, eventIndex);
	if (typeof observedAt === "string") return observedAt;
	return new Date().toISOString();
}

function parsePersistedEvent(line: string, lineIndex: number): PersistedCircuitBreakerEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		throw new Error(`Invalid circuit breaker JSONL at line ${lineIndex + 1}: ${(error as Error).message}`);
	}

	if (!isPersistedEvent(parsed)) {
		throw new Error(`Invalid circuit breaker event shape at line ${lineIndex + 1}`);
	}

	return parsed;
}

function isPersistedEvent(value: unknown): value is PersistedCircuitBreakerEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Partial<PersistedCircuitBreakerEvent>;
	return (
		typeof candidate.sessionId === "string" &&
		typeof candidate.eventIndex === "number" &&
		Number.isInteger(candidate.eventIndex) &&
		candidate.eventIndex >= 0 &&
		typeof candidate.observedAt === "string" &&
		typeof candidate.event === "object" &&
		candidate.event !== null
	);
}

function normalizeSessionId(sessionId: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
		throw new Error("sessionId must contain only letters, numbers, dots, underscores, or dashes");
	}
	return sessionId;
}
