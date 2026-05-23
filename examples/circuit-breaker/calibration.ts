import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

interface CalibrationRecord {
	id?: string;
	session_id?: string;
	detector?: string;
	severity?: string;
	human_decision?: "merged" | "rejected" | null;
	action?: {
		status?: "dry_run" | "opened_pr";
		pr_url?: string | null;
	};
	created_at?: string;
}

export interface CalibrationSummary {
	path: string;
	totalInterventions: number;
	totalPending: number;
	totalTruePositive: number;
	totalFalsePositive: number;
	detectors: Record<string, DetectorCalibrationStats>;
}

export interface DetectorCalibrationStats {
	total: number;
	pending: number;
	truePositive: number;
	falsePositive: number;
	precision: number | null;
}

export async function updateCalibration(rootDir = process.cwd(), now: Date = new Date()): Promise<CalibrationSummary> {
	const records = await readInterventionRecords(rootDir);
	const detectors = summarizeByDetector(records);
	const content = renderCalibrationMarkdown(records, detectors, now);
	const path = getCalibrationPath(rootDir);

	await mkdir(join(rootDir, "memory", "circuit-breaker"), { recursive: true });
	await writeFile(path, content, "utf8");

	return {
		path,
		totalInterventions: records.length,
		totalPending: records.filter((record) => !record.human_decision).length,
		totalTruePositive: records.filter((record) => record.human_decision === "merged").length,
		totalFalsePositive: records.filter((record) => record.human_decision === "rejected").length,
		detectors,
	};
}

export async function readInterventionRecords(rootDir = process.cwd()): Promise<CalibrationRecord[]> {
	const interventionsDir = join(rootDir, "memory", "circuit-breaker", "interventions");
	let files: string[];
	try {
		files = await readdir(interventionsDir);
	} catch (error) {
		if (isMissingDirectory(error)) return [];
		throw error;
	}

	const records: CalibrationRecord[] = [];
	for (const file of files.sort()) {
		if (!file.endsWith(".yaml")) continue;
		const parsed = YAML.parse(await readFile(join(interventionsDir, file), "utf8")) as CalibrationRecord | null;
		if (parsed) records.push(parsed);
	}
	return records;
}

function summarizeByDetector(records: CalibrationRecord[]): Record<string, DetectorCalibrationStats> {
	const stats: Record<string, DetectorCalibrationStats> = {};
	for (const record of records) {
		const detector = record.detector ?? "unknown";
		stats[detector] ??= {
			total: 0,
			pending: 0,
			truePositive: 0,
			falsePositive: 0,
			precision: null,
		};
		const current = stats[detector];
		current.total += 1;
		if (record.human_decision === "merged") {
			current.truePositive += 1;
		} else if (record.human_decision === "rejected") {
			current.falsePositive += 1;
		} else {
			current.pending += 1;
		}
	}

	for (const current of Object.values(stats)) {
		const decided = current.truePositive + current.falsePositive;
		current.precision = decided > 0 ? current.truePositive / decided : null;
	}
	return stats;
}

function renderCalibrationMarkdown(
	records: CalibrationRecord[],
	detectors: Record<string, DetectorCalibrationStats>,
	now: Date,
): string {
	const lines = [
		"# Circuit Breaker Calibration",
		"",
		`Last updated: ${now.toISOString()}`,
		`Total interventions: ${records.length}`,
		"",
		"Calibration is based only on human-labeled outcomes in intervention YAML files.",
		"Pending records are not counted as true or false positives.",
		"",
		"## Detector Accuracy",
		"",
		"| Detector | Total | True Positive | False Positive | Pending | Precision |",
		"|---|---:|---:|---:|---:|---:|",
	];

	for (const [detector, stats] of Object.entries(detectors).sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(
			`| ${detector} | ${stats.total} | ${stats.truePositive} | ${stats.falsePositive} | ${stats.pending} | ${formatPrecision(stats.precision)} |`,
		);
	}

	if (records.length === 0) {
		lines.push("| none | 0 | 0 | 0 | 0 | N/A |");
	}

	lines.push("", "## Recent Interventions", "");
	for (const record of records.slice(-10).reverse()) {
		const decision = record.human_decision ?? "pending";
		const pr = record.action?.pr_url ? ` | PR: ${record.action.pr_url}` : "";
		lines.push(`- ${record.id ?? "unknown"} | ${record.detector ?? "unknown"} | ${decision}${pr}`);
	}
	if (records.length === 0) {
		lines.push("- No interventions recorded yet.");
	}

	return `${lines.join("\n")}\n`;
}

function formatPrecision(value: number | null): string {
	return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function getCalibrationPath(rootDir: string): string {
	return join(rootDir, "memory", "circuit-breaker", "calibration.md");
}

function isMissingDirectory(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
