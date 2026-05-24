export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_MAX_TOKENS_ENV = "GITCLAW_DEFAULT_MAX_TOKENS";

export interface ModelConstraints {
	temperature?: number;
	maxTokens?: number;
	max_tokens?: number;
	topP?: number;
	top_p?: number;
	topK?: number;
	top_k?: number;
	stopSequences?: string[];
	stop_sequences?: string[];
}

export interface ModelOptionsConfig {
	defaultMaxTokens?: number;
	env?: NodeJS.ProcessEnv;
}

export function resolveDefaultMaxTokens(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[DEFAULT_MAX_TOKENS_ENV];
	if (!raw) return DEFAULT_MAX_TOKENS;

	const parsed = Number(raw);
	if (Number.isInteger(parsed) && parsed > 0) return parsed;

	return DEFAULT_MAX_TOKENS;
}

export function mergeModelConstraints(
	base?: ModelConstraints,
	override?: ModelConstraints,
): ModelConstraints | undefined {
	if (!base && !override) return undefined;
	return {
		...(base ?? {}),
		...(override ?? {}),
	};
}

export function buildModelOptionsFromConstraints(
	constraints?: ModelConstraints,
	config: ModelOptionsConfig = {},
): Record<string, any> {
	const modelOptions: Record<string, any> = {};

	if (constraints) {
		if (constraints.temperature !== undefined) modelOptions.temperature = constraints.temperature;
		if (constraints.maxTokens !== undefined) modelOptions.maxTokens = constraints.maxTokens;
		if (constraints.max_tokens !== undefined && modelOptions.maxTokens === undefined) {
			modelOptions.maxTokens = constraints.max_tokens;
		}
		if (constraints.topP !== undefined) modelOptions.topP = constraints.topP;
		if (constraints.top_p !== undefined && modelOptions.topP === undefined) modelOptions.topP = constraints.top_p;
		if (constraints.topK !== undefined) modelOptions.topK = constraints.topK;
		if (constraints.top_k !== undefined && modelOptions.topK === undefined) modelOptions.topK = constraints.top_k;
		if (constraints.stopSequences !== undefined) modelOptions.stopSequences = constraints.stopSequences;
		if (constraints.stop_sequences !== undefined && modelOptions.stopSequences === undefined) {
			modelOptions.stopSequences = constraints.stop_sequences;
		}
	}

	if (modelOptions.maxTokens === undefined) {
		modelOptions.maxTokens = config.defaultMaxTokens ?? resolveDefaultMaxTokens(config.env);
	}

	return modelOptions;
}
