import type { BoxInfo } from "./boxes";
import type { ExecResult } from "./exec";
import { SandboxError, type ErrorEnvelope } from "./wire";

export type CreateOptions = { name?: string; ttlSeconds?: number };
export type ExecOptions = { cmd: string; workdir?: string; timeoutSeconds?: number };
export type ExecResponse = { boxId: string; workspaceDir: string } & Omit<ExecResult, "outcome">;

export class SandboxUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnreachableError";
  }
}

export type SandboxClientOptions = { url: string; token: string };

// The one HTTP client for sandboxd; the CLI and Spekter's sandbox tools both go through it.
export function createSandboxClient({ url, token }: SandboxClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SandboxUnreachableError(`Sandbox service unreachable at ${url}. Is \`npm run sandboxd\` running?`);
    }

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (data as Partial<ErrorEnvelope> | null)?.error;
      throw new SandboxError(error?.code ?? "internal_error", error?.message ?? `sandboxd error: HTTP ${response.status}`);
    }
    return data as T;
  }

  const box = (id: string) => `/boxes/${encodeURIComponent(id)}`;

  return {
    request,
    health: (signal?: AbortSignal) => request<{ ok: true }>("GET", "/healthz", undefined, signal),
    create: (options: CreateOptions = {}, signal?: AbortSignal) => request<BoxInfo>("POST", "/boxes", options, signal),
    list: (signal?: AbortSignal) => request<{ boxes: BoxInfo[] }>("GET", "/boxes", undefined, signal),
    inspect: (id: string, signal?: AbortSignal) => request<BoxInfo>("GET", box(id), undefined, signal),
    destroy: (id: string, signal?: AbortSignal) => request<{ id: string; destroyed: true }>("DELETE", box(id), undefined, signal),
    exec: (id: string, options: ExecOptions, signal?: AbortSignal) =>
      request<ExecResponse>("POST", `${box(id)}/exec`, options, signal),
  };
}

export type SandboxClient = ReturnType<typeof createSandboxClient>;
