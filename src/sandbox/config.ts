import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SandboxError } from "./wire";

export type Env = Record<string, string | undefined>;

export type SandboxConfig = {
  port: number;
  token: string;
  logPath: string;
  // Daemon-written state only (Lima home, box state files); never mounted into a guest.
  sandboxDir: string;
  // Parent of every box's host workspace — guest-writable, so it must live outside the project.
  workspaceRoot: string;
  maxBoxes: number;
  ttlSeconds: number;
};

export const DEFAULT_PORT = 3210;
const DEFAULT_LOG_PATH = "logs/sandboxd.jsonl";
const DEFAULT_WORKSPACE_ROOT = "~/spekter-workspace";
const MIN_TOKEN_LENGTH = 32;

// Node's path functions treat "~" literally; expand it the way a shell would.
export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : resolve(path);
}

function readWorkspaceRoot(env: Env): string {
  const root = expandHome(env.SANDBOX_WORKSPACE_ROOT?.trim() || DEFAULT_WORKSPACE_ROOT);
  const project = resolve();
  if (root === project || root.startsWith(project + sep)) {
    throw new SandboxError("not_configured", `SANDBOX_WORKSPACE_ROOT must be outside the project (${project})`);
  }
  return root;
}

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
    sandboxDir: resolve(".sandbox"),
    workspaceRoot: readWorkspaceRoot(env),
    maxBoxes: readPositiveIntEnv(env, "SANDBOX_MAX_BOXES", 4),
    ttlSeconds: readPositiveIntEnv(env, "SANDBOX_TTL_SECONDS", 1800),
  };
}
