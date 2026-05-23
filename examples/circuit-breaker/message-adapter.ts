import type { GCMessage } from "../../src/sdk-types.js";

export type CircuitBreakerEvent =
	| {
		type: "tool_use";
		toolCallId: string;
		toolName: string;
		args: Record<string, unknown>;
	}
	| {
		type: "tool_result";
		toolCallId: string;
		toolName: string;
		content: string;
		isError: boolean;
	}
	| {
		type: "assistant_usage";
		model: string;
		provider: string;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		costUsd: number;
		stopReason: string;
	};

export interface PersistedCircuitBreakerEvent {
	sessionId: string;
	eventIndex: number;
	observedAt: string;
	event: CircuitBreakerEvent;
}

export class CircuitBreakerEventSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CircuitBreakerEventSchemaError";
	}
}

export function adaptGCMessage(message: GCMessage): CircuitBreakerEvent | null {
	const candidate = message as unknown;
	if (!isRecord(candidate)) {
		throw new CircuitBreakerEventSchemaError("GCMessage must be an object");
	}

	switch (candidate.type) {
		case "assistant":
			return adaptAssistant(candidate);
		case "tool_use":
			return adaptToolUse(candidate);
		case "tool_result":
			return adaptToolResult(candidate);
		case "system":
		case "user":
		case "delta":
			return null;
		default:
			throw new CircuitBreakerEventSchemaError(`Unsupported GCMessage type: ${String(candidate.type)}`);
	}
}

function adaptAssistant(message: Record<string, unknown>): CircuitBreakerEvent {
	const usage = requireRecord(message.usage, "assistant.usage");

	return {
		type: "assistant_usage",
		model: requireString(message.model, "assistant.model"),
		provider: requireString(message.provider, "assistant.provider"),
		inputTokens: requireNumber(usage.inputTokens, "assistant.usage.inputTokens"),
		outputTokens: requireNumber(usage.outputTokens, "assistant.usage.outputTokens"),
		totalTokens: requireNumber(usage.totalTokens, "assistant.usage.totalTokens"),
		costUsd: requireNumber(usage.costUsd, "assistant.usage.costUsd"),
		stopReason: requireString(message.stopReason, "assistant.stopReason"),
	};
}

function adaptToolUse(message: Record<string, unknown>): CircuitBreakerEvent {
	const args = requireRecord(message.args, "tool_use.args");

	return {
		type: "tool_use",
		toolCallId: requireString(message.toolCallId, "tool_use.toolCallId"),
		toolName: requireString(message.toolName, "tool_use.toolName"),
		args,
	};
}

function adaptToolResult(message: Record<string, unknown>): CircuitBreakerEvent {
	return {
		type: "tool_result",
		toolCallId: requireString(message.toolCallId, "tool_result.toolCallId"),
		toolName: requireString(message.toolName, "tool_result.toolName"),
		content: requireString(message.content, "tool_result.content"),
		isError: requireBoolean(message.isError, "tool_result.isError"),
	};
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CircuitBreakerEventSchemaError(`${fieldName} must be a non-empty string`);
	}
	return value;
}

function requireNumber(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new CircuitBreakerEventSchemaError(`${fieldName} must be a finite number`);
	}
	return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
	if (typeof value !== "boolean") {
		throw new CircuitBreakerEventSchemaError(`${fieldName} must be a boolean`);
	}
	return value;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new CircuitBreakerEventSchemaError(`${fieldName} must be an object`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
