import { resolve } from "node:path";
import { SandboxError } from "./wire";

export type Env = Record<string, string | undefined>;

export type SandboxConfig = {
  port: number;
  token: string;
  logPath: string;
};

export const DEFAULT_PORT = 3210;
const DEFAULT_LOG_PATH = "logs/sandboxd.jsonl";
const MIN_TOKEN_LENGTH = 32;

// An optional positive-whole-number env var; a bad value is a configuration error, never ignored.
export function readPositiveIntEnv(env: Env, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new SandboxError("not_configured", `${name} must be a positive whole number, got "${value}"`);
  }
  return Number(value);
}

// The shared secret that tells host callers apart from guests forging local headers.
export function readToken(env: Env): string {
  const token = env.SANDBOX_TOKEN?.trim();
  if (!token) throw new SandboxError("not_configured", "Missing environment variable: SANDBOX_TOKEN");
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new SandboxError(
      "not_configured",
      `SANDBOX_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters; generate one with \`openssl rand -hex 32\``,
    );
  }
  return token;
}

export function readSandboxConfig(env: Env = process.env): SandboxConfig {
  return {
    port: readPositiveIntEnv(env, "SANDBOX_PORT", DEFAULT_PORT),
    token: readToken(env),
    logPath: resolve(env.SANDBOX_LOG?.trim() || DEFAULT_LOG_PATH),
  };
}
