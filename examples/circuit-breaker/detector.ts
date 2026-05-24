import type { PersistedCircuitBreakerEvent } from "./message-adapter.js";

const STABLE_JSON_KEYS = new Set(["url", "uri", "href", "path", "file", "id", "sha"]);
const STRIP_QUERY_PARAMS = new Set(["ts", "timestamp", "cache_bust"]);

export type ResultDelta = number | "unknown";

export interface ResultDeltaInput {
	previousItems?: Iterable<string>;
	windowContents: string[];
}

export interface ResultDeltaResult {
	resultDelta: ResultDelta;
	windowItems: string[];
	newItems: string[];
}

export interface ToolLoopDetectorOptions {
	toolWindow?: number;
	argSimilarityThreshold?: number;
	minResultDelta?: number;
	allowTextFallback?: boolean;
}

export interface ToolLoopFinding {
	type: "tool_loop";
	detector: "tool-loop-v1";
	severity: "high";
	toolName: string;
	windowSize: number;
	eventIndexes: number[];
	toolCallIds: string[];
	argSimilarity: number;
	resultDelta: number;
	confidence: number;
	argsWindow: Array<Record<string, unknown>>;
	resultItems: string[];
	newItems: string[];
}

interface ToolUseResultPair {
	toolUse: PersistedCircuitBreakerEvent & { event: Extract<PersistedCircuitBreakerEvent["event"], { type: "tool_use" }> };
	toolResult: PersistedCircuitBreakerEvent & { event: Extract<PersistedCircuitBreakerEvent["event"], { type: "tool_result" }> };
}

const DEFAULT_TOOL_LOOP_OPTIONS = {
	toolWindow: 3,
	argSimilarityThreshold: 0.90,
	minResultDelta: 0.05,
	allowTextFallback: false,
};

export function extractStableResultItems(content: string): string[] {
	const jsonItems = extractJsonItems(content);
	if (jsonItems.length > 0) return unique(jsonItems.map(normalizeStableItem));

	return unique(extractTextItems(content).map(normalizeStableItem));
}

export function computeResultDelta(input: ResultDeltaInput): ResultDeltaResult {
	const previousItems = new Set(input.previousItems ?? []);
	const windowItems = unique(input.windowContents.flatMap((content) => extractStableResultItems(content)));

	if (windowItems.length === 0) {
		return {
			resultDelta: "unknown",
			windowItems: [],
			newItems: [],
		};
	}

	const newItems = windowItems.filter((item) => !previousItems.has(item));
	return {
		resultDelta: newItems.length / Math.max(1, windowItems.length),
		windowItems,
		newItems,
	};
}

export function detectToolLoop(
	events: PersistedCircuitBreakerEvent[],
	options: ToolLoopDetectorOptions = {},
): ToolLoopFinding | null {
	const resolved = { ...DEFAULT_TOOL_LOOP_OPTIONS, ...options };
	const pairs = pairToolUseResults(events);
	const matches: ToolLoopFinding[] = [];

	for (let start = 0; start <= pairs.length - resolved.toolWindow; start += 1) {
		const window = pairs.slice(start, start + resolved.toolWindow);
		const toolName = window[0]?.toolUse.event.toolName;
		if (!toolName || !window.every((pair) => pair.toolUse.event.toolName === toolName)) continue;

		const argSimilarity = averageAdjacentSimilarity(window.map((pair) => stableStringify(pair.toolUse.event.args)));
		if (argSimilarity < resolved.argSimilarityThreshold) continue;

		const hasStableItems = window.some((pair) => extractStableResultItems(pair.toolResult.event.content).length > 0);
		
		let delta: ResultDeltaResult;
		
		if (hasStableItems) {
			const previousItems = pairs
				.slice(0, start)
				.flatMap((pair) => extractStableResultItems(pair.toolResult.event.content));
			delta = computeResultDelta({
				previousItems,
				windowContents: window.map((pair) => pair.toolResult.event.content),
			});
		} else if (resolved.allowTextFallback) {
			// Fallback word-level tokenization to prevent loops on plain text outputs
			const tokenize = (content: string) => 
				content.split(/[^A-Za-z0-9_-]+/g).map(t => t.trim()).filter(t => t.length > 0);
			
			const windowItems = unique(window.flatMap((pair) => tokenize(pair.toolResult.event.content)));
			const previousSet = new Set(pairs.slice(0, start).flatMap((pair) => tokenize(pair.toolResult.event.content)));
			
			if (windowItems.length === 0) {
				delta = {
					resultDelta: "unknown",
					windowItems: [],
					newItems: [],
				};
			} else {
				const newItems = windowItems.filter((item) => !previousSet.has(item));
				delta = {
					resultDelta: newItems.length / Math.max(1, windowItems.length),
					windowItems,
					newItems,
				};
			}
		} else {
			delta = {
				resultDelta: "unknown",
				windowItems: [],
				newItems: [],
			};
		}
		if (delta.resultDelta === "unknown" || delta.resultDelta >= resolved.minResultDelta) continue;

		const eventIndexes = window.flatMap((pair) => [pair.toolUse.eventIndex, pair.toolResult.eventIndex]);
		const confidence = round4(argSimilarity * (1 - delta.resultDelta));

		matches.push({
			type: "tool_loop",
			detector: "tool-loop-v1",
			severity: "high",
			toolName,
			windowSize: resolved.toolWindow,
			eventIndexes,
			toolCallIds: window.map((pair) => pair.toolUse.event.toolCallId),
			argSimilarity: round4(argSimilarity),
			resultDelta: round4(delta.resultDelta),
			confidence,
			argsWindow: window.map((pair) => pair.toolUse.event.args),
			resultItems: delta.windowItems,
			newItems: delta.newItems,
		});
	}

	return matches.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function extractJsonItems(content: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [];
	}

	const items: string[] = [];
	walkJson(parsed, items);
	return items;
}

function walkJson(value: unknown, items: string[], key?: string) {
	if (key && STABLE_JSON_KEYS.has(key) && isStablePrimitive(value)) {
		items.push(String(value));
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) walkJson(item, items);
		return;
	}

	if (typeof value === "object" && value !== null) {
		for (const [childKey, childValue] of Object.entries(value)) {
			walkJson(childValue, items, childKey);
		}
	}
}

function extractTextItems(content: string): string[] {
	return [
		...extractUrlItems(content),
		...extractPathItems(content),
	];
}

function extractUrlItems(content: string): string[] {
	return [...content.matchAll(/\bhttps?:\/\/[^\s"'<>),\]]+/gi)].map((match) => stripTrailingPunctuation(match[0]));
}

function extractPathItems(content: string): string[] {
	const matches = content.matchAll(/(?:^|\s)((?:\.{1,2}\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g);
	return [...matches].map((match) => stripTrailingPunctuation(match[1]));
}

function normalizeStableItem(value: string): string {
	const trimmed = stripTrailingPunctuation(value.trim());
	if (trimmed.length === 0) return trimmed;

	try {
		const url = new URL(trimmed);
		if (url.protocol === "http:" || url.protocol === "https:") {
			url.hostname = url.hostname.toLowerCase();
			url.hash = "";
			for (const key of [...url.searchParams.keys()]) {
				if (key.toLowerCase().startsWith("utm_") || STRIP_QUERY_PARAMS.has(key.toLowerCase())) {
					url.searchParams.delete(key);
				}
			}
			url.searchParams.sort();
			return url.toString();
		}
	} catch {
		// Not a URL; use the trimmed stable id/path.
	}

	return trimmed;
}

function isStablePrimitive(value: unknown): value is string | number {
	return typeof value === "string" || typeof value === "number";
}

function stripTrailingPunctuation(value: string): string {
	return value.replace(/[.,;:!?]+$/g, "");
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (value.length === 0 || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function pairToolUseResults(events: PersistedCircuitBreakerEvent[]): ToolUseResultPair[] {
	const resultsByCallId = new Map<string, ToolUseResultPair["toolResult"]>();
	for (const event of events) {
		if (event.event.type === "tool_result") {
			resultsByCallId.set(event.event.toolCallId, event as ToolUseResultPair["toolResult"]);
		}
	}

	const pairs: ToolUseResultPair[] = [];
	for (const event of events) {
		if (event.event.type !== "tool_use") continue;
		const toolResult = resultsByCallId.get(event.event.toolCallId);
		if (!toolResult) continue;
		pairs.push({
			toolUse: event as ToolUseResultPair["toolUse"],
			toolResult,
		});
	}
	return pairs.sort((a, b) => a.toolUse.eventIndex - b.toolUse.eventIndex);
}

function averageAdjacentSimilarity(values: string[]): number {
	if (values.length < 2) return 1;
	let total = 0;
	for (let index = 0; index < values.length - 1; index += 1) {
		total += stringSimilarity(values[index], values[index + 1]);
	}
	return total / (values.length - 1);
}

function stringSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length === 0 || b.length === 0) return 0;
	const distance = levenshteinDistance(a, b);
	return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a: string, b: string): number {
	const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
	const current = Array.from({ length: b.length + 1 }, () => 0);

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				current[j - 1] + 1,
				previous[j] + 1,
				previous[j - 1] + cost,
			);
		}
		previous.splice(0, previous.length, ...current);
	}

	return previous[b.length];
}

function stableStringify(value: Record<string, unknown>): string {
	return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObject);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, child]) => [key, sortObject(child)]),
	);
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}
