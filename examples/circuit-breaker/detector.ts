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
