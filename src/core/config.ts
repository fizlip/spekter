import { NotConfiguredError } from "./errors";

export type Config = {
  apiKey: string;
  model: string;
};

export type Env = Record<string, string | undefined>;

export const DEFAULT_MAX_STEPS = 5;

// Optional cap on model steps per request; a bad value is a configuration error, never ignored.
export function readMaxSteps(env: Env = process.env): number {
  const value = env.SPEKTER_MAX_STEPS?.trim();
  if (!value) return DEFAULT_MAX_STEPS;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new NotConfiguredError(`SPEKTER_MAX_STEPS must be a positive whole number, got "${value}"`);
  }
  return Number(value);
}

export function readConfiguredModel(env: Env = process.env): string | null {
  return env.SPEKTER_MODEL?.trim() || null;
}

export function readConfig(env: Env = process.env): Config {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const model = env.SPEKTER_MODEL?.trim();
  const missing = [
    !apiKey && "OPENROUTER_API_KEY",
    !model && "SPEKTER_MODEL",
  ].filter(Boolean);

  if (!apiKey || !model) {
    const label = missing.length > 1 ? "variables" : "variable";
    throw new NotConfiguredError(`Missing environment ${label}: ${missing.join(", ")}`);
  }

  return { apiKey, model };
}
