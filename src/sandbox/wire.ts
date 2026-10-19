// The HTTP contract shared by sandboxd, the sandbox CLI, and Spekter's sandbox tools.
// Sandbox-local on purpose: the daemon imports nothing from @/core, so it stays extractable.

export type SandboxErrorCode =
  | "invalid_request"
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error";

export const statusByCode: Record<SandboxErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
  not_configured: 503,
};

export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export type ErrorEnvelope = { error: { code: SandboxErrorCode; message: string } };
