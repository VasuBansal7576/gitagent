import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { CircuitBreakerEvent } from "./message-adapter.ts";

export interface CircuitBreakerRunIdentityInput {
	agentDir?: string;
	agentName?: string;
	rulesHash?: string;
	events: CircuitBreakerEvent[];
}

export interface CircuitBreakerRunIdentity {
	agentName: string;
	model: string;
	rulesHash: string;
}

export async function resolveRunIdentity(input: CircuitBreakerRunIdentityInput): Promise<CircuitBreakerRunIdentity> {
	return {
		agentName: input.agentName ?? inferAgentName(input.agentDir),
		model: inferModel(input.events),
		rulesHash: input.rulesHash ?? await inferRulesHash(input.agentDir),
	};
}

function inferAgentName(agentDir?: string): string {
	if (!agentDir) return "unknown";
	return basename(agentDir.replace(/\/+$/g, "")) || "unknown";
}

function inferModel(events: CircuitBreakerEvent[]): string {
	const usage = events.find((event) => event.type === "assistant_usage");
	if (!usage) return "unknown";
	return `${usage.provider}:${usage.model}`;
}

async function inferRulesHash(agentDir?: string): Promise<string> {
	if (!agentDir) return "unknown";

	try {
		const rules = await readFile(join(agentDir, "RULES.md"), "utf8");
		return createHash("sha256").update(rules).digest("hex").slice(0, 8);
	} catch (error) {
		if (isMissingFile(error)) return "unknown";
		throw error;
	}
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
