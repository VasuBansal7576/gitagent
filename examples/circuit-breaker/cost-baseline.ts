import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

export interface CostSample {
	agentName: string;
	model: string;
	rulesHash: string;
	costUsd: number;
	observedAt?: Date | string;
}

export interface CostBaseline {
	key: string;
	agent_name: string;
	model: string;
	rules_hash: string;
	samples: number[];
	sample_count: number;
	avg_cost_per_run: number;
	p95_cost_per_run: number;
	max_observed: number;
	last_updated: string;
}

export interface CostDetectionOptions {
	minBaselineSamples?: number;
	multiplierOverP95?: number;
	absoluteFloorUsd?: number;
}

export type CostClassification =
	| {
		type: "none";
		actual_cost: number;
		reason: string;
		baseline_samples: number;
	}
	| {
		type: "absolute_budget_warning";
		actual_cost: number;
		absolute_floor_usd: number;
		baseline_samples: number;
	}
	| {
		type: "cost_anomaly";
		actual_cost: number;
		p95_baseline: number;
		anomaly_ratio: number;
		baseline_samples: number;
	};

export interface CostAnalysisResult {
	key: string;
	previousBaseline: CostBaseline | null;
	updatedBaseline: CostBaseline;
	classification: CostClassification;
	path: string;
}

const DEFAULT_COST_OPTIONS = {
	minBaselineSamples: 5,
	multiplierOverP95: 3,
	absoluteFloorUsd: 1,
};

export async function analyzeCostAndUpdateBaseline(
	rootDir: string,
	sample: CostSample,
	options: CostDetectionOptions = {},
): Promise<CostAnalysisResult> {
	const key = costBaselineKey(sample);
	const previousBaseline = await readCostBaseline(rootDir, key);
	const classification = classifyCost(sample.costUsd, previousBaseline, options);
	const updatedBaseline = await writeUpdatedCostBaseline(rootDir, sample, previousBaseline);
	return {
		key,
		previousBaseline,
		updatedBaseline,
		classification,
		path: getCostBaselinePath(rootDir, key),
	};
}

export function classifyCost(
	actualCost: number,
	baseline: CostBaseline | null,
	options: CostDetectionOptions = {},
): CostClassification {
	const resolved = { ...DEFAULT_COST_OPTIONS, ...options };
	const baselineSamples = baseline?.sample_count ?? 0;

	if (!baseline || baselineSamples < resolved.minBaselineSamples) {
		if (actualCost >= resolved.absoluteFloorUsd) {
			return {
				type: "absolute_budget_warning",
				actual_cost: round6(actualCost),
				absolute_floor_usd: resolved.absoluteFloorUsd,
				baseline_samples: baselineSamples,
			};
		}
		return {
			type: "none",
			actual_cost: round6(actualCost),
			reason: "insufficient_baseline_samples",
			baseline_samples: baselineSamples,
		};
	}

	const ratio = baseline.p95_cost_per_run > 0 ? actualCost / baseline.p95_cost_per_run : 0;
	if (ratio >= resolved.multiplierOverP95) {
		return {
			type: "cost_anomaly",
			actual_cost: round6(actualCost),
			p95_baseline: baseline.p95_cost_per_run,
			anomaly_ratio: round2(ratio),
			baseline_samples: baselineSamples,
		};
	}

	return {
		type: "none",
		actual_cost: round6(actualCost),
		reason: "within_baseline",
		baseline_samples: baselineSamples,
	};
}

export async function readCostBaseline(rootDir: string, key: string): Promise<CostBaseline | null> {
	try {
		const content = await readFile(getCostBaselinePath(rootDir, key), "utf8");
		return YAML.parse(content) as CostBaseline;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function costBaselineKey(sample: Pick<CostSample, "agentName" | "model" | "rulesHash">): string {
	return sanitizeKey(`${sample.agentName}__${sample.model}__${sample.rulesHash}`);
}

function getCostBaselinePath(rootDir: string, key: string): string {
	return join(rootDir, "memory", "circuit-breaker", "baselines", `${key}.yaml`);
}

async function writeUpdatedCostBaseline(
	rootDir: string,
	sample: CostSample,
	previousBaseline: CostBaseline | null,
): Promise<CostBaseline> {
	const key = costBaselineKey(sample);
	const samples = [...(previousBaseline?.samples ?? []), round6(sample.costUsd)];
	const baseline: CostBaseline = {
		key,
		agent_name: sample.agentName,
		model: sample.model,
		rules_hash: sample.rulesHash,
		samples,
		sample_count: samples.length,
		avg_cost_per_run: round6(samples.reduce((total, cost) => total + cost, 0) / samples.length),
		p95_cost_per_run: round6(percentile(samples, 0.95)),
		max_observed: round6(Math.max(...samples)),
		last_updated: normalizeObservedAt(sample.observedAt).toISOString(),
	};

	await mkdir(join(rootDir, "memory", "circuit-breaker", "baselines"), { recursive: true });
	await writeFile(getCostBaselinePath(rootDir, key), YAML.stringify(baseline), "utf8");
	return baseline;
}

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 1) return sorted[0];
	const index = Math.ceil(p * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function normalizeObservedAt(observedAt?: Date | string): Date {
	if (observedAt instanceof Date) return observedAt;
	if (typeof observedAt === "string") return new Date(observedAt);
	return new Date();
}

function sanitizeKey(key: string): string {
	return key.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round6(value: number): number {
	return Math.round(value * 1000000) / 1000000;
}
