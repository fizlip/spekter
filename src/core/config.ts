import { NotConfiguredError } from "./errors";

export type Config = {
  // OpenRouter key; absent in local-only setups — checked when a public model runs.
  apiKey: string | null;
  model: string;
  // OpenAI-compatible local server (llama.cpp, LM Studio, ...); null disables local models.
  localBaseUrl: string | null;
  localApiKey: string | null;
};

export type Env = Record<string, string | undefined>;

export const DEFAULT_MAX_STEPS = 5;

// Throw naming every missing variable; returns the trimmed values when all are set.
export function requireEnvVars(env: Env, names: string[]): Record<string, string> {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) {
    const label = missing.length > 1 ? "variables" : "variable";
    throw new NotConfiguredError(`Missing environment ${label}: ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((name) => [name, env[name]!.trim()!]));
}

// An optional positive-whole-number env var; a bad value is a configuration error, never ignored.
export function readPositiveIntEnv(env: Env, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new NotConfiguredError(`${name} must be a positive whole number, got "${value}"`);
  }
  return Number(value);
}

// Optional cap on model steps per request.
export function readMaxSteps(env: Env = process.env): number {
  return readPositiveIntEnv(env, "SPEKTER_MAX_STEPS", DEFAULT_MAX_STEPS);
}

export function readConfiguredModel(env: Env = process.env): string | null {
  return env.SPEKTER_MODEL?.trim() || null;
}

// OPENROUTER_API_KEY is optional: a request for a local/<id> model never needs it,
// and resolveModelConfig throws only when a public model runs without the key.
export function readConfig(env: Env = process.env): Config {
  const { SPEKTER_MODEL: model } = requireEnvVars(env, ["SPEKTER_MODEL"]);
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    model,
    localBaseUrl: env.SPEKTER_LOCAL_BASE_URL?.trim() || null,
    localApiKey: env.SPEKTER_LOCAL_API_KEY?.trim() || null,
  };
}
