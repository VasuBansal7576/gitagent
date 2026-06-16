import { isAbsolute, relative, resolve } from "path";

export const DEFAULT_VOICE_HOST = "127.0.0.1";
export const CSRF_HEADER = "x-gitagent-csrf";
export const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function resolveInsideRoot(root: string, requestedPath: string): string | null {
	const rootAbs = resolve(root);
	const abs = resolve(rootAbs, requestedPath);
	const rel = relative(rootAbs, abs);
	if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return abs;
	return null;
}

export function isLoopbackHost(host: string): boolean {
	return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function resolveVoiceHost(env: NodeJS.ProcessEnv = process.env): string {
	return env.GITAGENT_HOST || env.GITCLAW_HOST || DEFAULT_VOICE_HOST;
}

export function assertVoiceAuthConfig(host: string, hasPassword: boolean): void {
	if (!hasPassword && !isLoopbackHost(host)) {
		throw new Error("GITAGENT_PASSWORD is required when GITAGENT_HOST is not loopback");
	}
}

export function isSafeSkillSource(source: string): boolean {
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[A-Za-z0-9_.-]+)?$/.test(source);
}

export function redactForLog(value: string): string {
	return value
		.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
		.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted-key]")
		.replace(/ghp_[A-Za-z0-9]{20,}/g, "[redacted-token]")
		.replace(/xox[bsap]-[A-Za-z0-9-]+/g, "[redacted-token]")
		.replace(/AKIA[0-9A-Z]{16}/g, "[redacted-key]")
		.replace(/\+?\b\d{7,15}\b/g, "[redacted-number]");
}

export function previewForLog(value: string, max = 32): string {
	const clean = redactForLog(value.replace(/\s+/g, " ").trim());
	return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}
