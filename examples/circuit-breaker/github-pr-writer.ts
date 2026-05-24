import type { CircuitBreakerIntervention } from "./intervention-writer.ts";
import type { PatchPlan } from "./patch-planner.ts";
import { applyPatchPlanToContent, hydratePatchPlanWithContent } from "./patch-planner.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface GitHubPrWriterOptions {
	token: string;
	repository: string;
	intervention: CircuitBreakerIntervention;
	patchPlan: PatchPlan;
	baseBranch?: string;
	branchName?: string;
	fetchImpl?: FetchLike;
	apiBaseUrl?: string;
	artifactRootDir?: string;
	enforceRateLimit?: boolean;
}

export interface GitHubPrResult {
	url: string;
	number: number;
	branchName: string;
	baseBranch: string;
	target: string;
	commitSha?: string;
	alreadyOpen: boolean;
	patch: string;
	prTitle: string;
	prBody: string;
}

export class GitHubPrError extends Error {
	readonly status?: number;
	readonly responseBody?: unknown;

	constructor(message: string, status?: number, responseBody?: unknown) {
		super(message);
		this.name = "GitHubPrError";
		this.status = status;
		this.responseBody = responseBody;
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PR_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;
const CIRCUIT_BREAKER_MEMORY_DIR = ["memory", "circuit-breaker"] as const;
const LAST_PR_TIMESTAMP_FILE = ".last_pr_timestamp";

interface GitRefResponse {
	object: {
		sha: string;
	};
}

interface RepoContentResponse {
	type: string;
	sha: string;
	content: string;
	encoding: string;
}

interface UpdateFileResponse {
	commit?: {
		sha?: string;
	};
}

interface PullResponse {
	html_url: string;
	number: number;
}

interface GitHubErrorResponse {
	message?: string;
	errors?: unknown[];
}

function redactSecrets(text: string): string {
	if (!text) return text;
	return text
		.replace(/\b(?:sk|sk-proj)-[a-zA-Z0-9-_]{40,100}\b/g, "[REDACTED_SECRET]")
		.replace(/\b(?:ghp|gho|ghs|github_pat)_[a-zA-Z0-9_]{36,255}\b/g, "[REDACTED_SECRET]")
		.replace(/\bgroq_[a-zA-Z0-9]{36,40}\b/g, "[REDACTED_SECRET]")
		.replace(/\bglpat-[a-zA-Z0-9-_]{20,40}\b/g, "[REDACTED_SECRET]")
		.replace(/\bxox[bpr]-[a-zA-Z0-9-]{10,60}\b/g, "[REDACTED_SECRET]")
		.replace(/\bsk_(?:live|test)_[a-zA-Z0-9]{24,32}\b/g, "[REDACTED_SECRET]")
		.replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_SECRET]")
		.replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, "[REDACTED_SECRET]")
		.replace(/(bearer\s+)[a-zA-Z0-9-._~+/]+=*/gi, "$1[REDACTED_BEARER_TOKEN]");
}

export async function openGitHubPrForPatch(options: GitHubPrWriterOptions): Promise<GitHubPrResult> {
	validateOptions(options);

	const rateLimitState = resolvePrRateLimitState(options);
	if (rateLimitState.enabled && await hasRecentPr(rateLimitState.filePath)) {
		throw new GitHubPrError("Rate limit exceeded: only one automated PR is allowed every 24 hours.");
	}
	const baseBranch = options.baseBranch ?? "main";
	const branchName = options.branchName ?? defaultBranchName(options.intervention);
	const repo = parseGitHubRepository(options.repository);
	const api = new GitHubApi({
		token: options.token,
		apiBaseUrl: options.apiBaseUrl ?? "https://api.github.com",
		fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
	});

	const baseRef = await api.getJson<GitRefResponse>(
		`/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
	);
	await createBranchIfNeeded(api, repo, branchName, baseRef.object.sha);

	const file = await api.getJson<RepoContentResponse>(
		`/repos/${repo.owner}/${repo.name}/contents/${encodeGitHubPath(options.patchPlan.target)}?ref=${encodeURIComponent(branchName)}`,
	);
	if (file.type !== "file" || file.encoding !== "base64") {
		throw new GitHubPrError(`Patch target is not a base64 file: ${options.patchPlan.target}`);
	}

	const currentContent = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
	const effectivePatchPlan = hydratePatchPlanWithContent(options.intervention, options.patchPlan, currentContent);
	const patched = applyPatchPlanToContent(currentContent, effectivePatchPlan);
	let commitSha: string | undefined;
	if (patched.changed) {
		const update = await api.putJson<UpdateFileResponse>(
			`/repos/${repo.owner}/${repo.name}/contents/${encodeGitHubPath(effectivePatchPlan.target)}`,
			{
				message: redactSecrets(effectivePatchPlan.prTitle),
				content: Buffer.from(redactSecrets(patched.content), "utf8").toString("base64"),
				sha: file.sha,
				branch: branchName,
			},
		);
		commitSha = update.commit?.sha;
	}

	const pull = await createPullRequestOrReuse(api, repo, {
		title: redactSecrets(effectivePatchPlan.prTitle),
		body: redactSecrets(effectivePatchPlan.prBody),
		head: branchName,
		base: baseBranch,
	});

	if (rateLimitState.enabled) {
		await writePrTimestamp(rateLimitState.filePath);
	}

	return {
		url: pull.html_url,
		number: pull.number,
		branchName,
		baseBranch,
		target: effectivePatchPlan.target,
		commitSha,
		alreadyOpen: pull.alreadyOpen,
		patch: effectivePatchPlan.patch,
		prTitle: effectivePatchPlan.prTitle,
		prBody: effectivePatchPlan.prBody,
	};
}

function resolvePrRateLimitState(options: GitHubPrWriterOptions): { enabled: boolean; filePath: string } {
	const rootDir = options.artifactRootDir ?? process.cwd();
	return {
		enabled: options.enforceRateLimit ?? !options.fetchImpl,
		filePath: join(rootDir, ...CIRCUIT_BREAKER_MEMORY_DIR, LAST_PR_TIMESTAMP_FILE),
	};
}

async function hasRecentPr(path: string): Promise<boolean> {
	try {
		const lastPrTime = Number(await readFile(path, "utf8"));
		return Number.isFinite(lastPrTime) && Date.now() - lastPrTime < PR_RATE_LIMIT_MS;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function writePrTimestamp(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, Date.now().toString(), "utf8");
}

export function parseGitHubRepository(repository: string): { owner: string; name: string } {
	const match = repository.match(/^([^/\s]+)\/([^/\s]+)$/);
	if (!match) {
		throw new GitHubPrError("GitHub repository must be in OWNER/REPO form");
	}
	return { owner: match[1], name: match[2].replace(/\.git$/, "") };
}

export function defaultBranchName(intervention: CircuitBreakerIntervention): string {
	const safeId = intervention.id.replace(/[^A-Za-z0-9._-]/g, "-");
	return `circuit-breaker/${safeId}`;
}

async function createBranchIfNeeded(
	api: GitHubApi,
	repo: { owner: string; name: string },
	branchName: string,
	sha: string,
): Promise<void> {
	const response = await api.raw(`/repos/${repo.owner}/${repo.name}/git/refs`, {
		method: "POST",
		body: JSON.stringify({
			ref: `refs/heads/${branchName}`,
			sha,
		}),
	});

	if (response.ok) return;
	if (response.status === 422) {
		const body = await api.parse<GitHubErrorResponse>(response.clone());
		if (isReferenceAlreadyExists(body)) return;
		throw new GitHubPrError(`Could not create branch ${branchName} (${response.status})`, response.status, body);
	}
	throw await api.toError(response, `Could not create branch ${branchName}`);
}

async function createPullRequestOrReuse(
	api: GitHubApi,
	repo: { owner: string; name: string },
	input: { title: string; body: string; head: string; base: string },
): Promise<PullResponse & { alreadyOpen: boolean }> {
	const response = await api.raw(`/repos/${repo.owner}/${repo.name}/pulls`, {
		method: "POST",
		body: JSON.stringify(input),
	});

	if (response.ok) {
		const pull = await api.parse<PullResponse>(response);
		return { ...pull, alreadyOpen: false };
	}

	if (response.status === 422) {
		const existing = await findOpenPullRequest(api, repo, input.head, input.base);
		if (existing) return { ...existing, alreadyOpen: true };
	}

	throw await api.toError(response, "Could not create pull request");
}

async function findOpenPullRequest(
	api: GitHubApi,
	repo: { owner: string; name: string },
	head: string,
	base: string,
): Promise<PullResponse | null> {
	const pulls = await api.getJson<PullResponse[]>(
		`/repos/${repo.owner}/${repo.name}/pulls?state=open&head=${encodeURIComponent(`${repo.owner}:${head}`)}&base=${encodeURIComponent(base)}`,
	);
	return pulls[0] ?? null;
}

function validateOptions(options: GitHubPrWriterOptions): void {
	if (!options.token) throw new GitHubPrError("GITHUB_TOKEN is required for --open-pr");
	if (!options.repository) throw new GitHubPrError("--github-repo OWNER/REPO is required for --open-pr");
	if (!options.patchPlan.target) throw new GitHubPrError("Patch plan target is required");
}

function isReferenceAlreadyExists(body: GitHubErrorResponse): boolean {
	const serialized = JSON.stringify(body).toLowerCase();
	return /reference already exists|already_exists|reference_exists/.test(serialized);
}

function encodeGitHubPath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

class GitHubApi {
	private readonly options: { token: string; apiBaseUrl: string; fetchImpl: FetchLike };

	constructor(options: { token: string; apiBaseUrl: string; fetchImpl: FetchLike }) {
		this.options = options;
	}

	async getJson<T>(path: string): Promise<T> {
		const response = await this.raw(path);
		if (!response.ok) throw await this.toError(response, `GitHub GET failed: ${path}`);
		return this.parse<T>(response);
	}

	async putJson<T>(path: string, body: unknown): Promise<T> {
		const response = await this.raw(path, { method: "PUT", body: JSON.stringify(body) });
		if (!response.ok) throw await this.toError(response, `GitHub PUT failed: ${path}`);
		return this.parse<T>(response);
	}

	async raw(path: string, init: RequestInit = {}): Promise<Response> {
		return this.options.fetchImpl(`${this.options.apiBaseUrl}${path}`, {
			...init,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${this.options.token}`,
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2026-03-10",
				...(init.headers ?? {}),
			},
		});
	}

	async parse<T>(response: Response): Promise<T> {
		const text = await response.text();
		return (text ? JSON.parse(text) : null) as T;
	}

	async toError(response: Response, message: string): Promise<GitHubPrError> {
		let body: unknown;
		try {
			body = await this.parse<unknown>(response);
		} catch {
			body = await response.text().catch(() => undefined);
		}
		return new GitHubPrError(`${message} (${response.status})`, response.status, body);
	}
}
