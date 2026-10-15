import { NotConfiguredError } from "./errors";

export type Config = {
  apiKey: string;
  model: string;
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

export function readConfig(env: Env = process.env): Config {
  const { OPENROUTER_API_KEY: apiKey, SPEKTER_MODEL: model } = requireEnvVars(env, [
    "OPENROUTER_API_KEY",
    "SPEKTER_MODEL",
  ]);
  return { apiKey, model };
}
