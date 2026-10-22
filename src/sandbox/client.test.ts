import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxClient, SandboxUnreachableError } from "./client";
import { createHandler } from "./server";
import { SandboxError } from "./wire";

const token = "t".repeat(32);
const url = "http://127.0.0.1:3210";

// Routes fetch straight into the daemon handler, adding the Host header a real socket would carry.
function serveWith(handler: (request: Request) => Promise<Response>) {
  vi.stubGlobal("fetch", (input: string, init: RequestInit) =>
    handler(new Request(input, { ...init, headers: { ...(init.headers as Record<string, string>), host: new URL(input).host } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSandboxClient", () => {
  it("reaches the daemon with the bearer token", async () => {
    serveWith(createHandler({ token, routes: [] }));

    await expect(createSandboxClient({ url, token }).health()).resolves.toEqual({ ok: true });
  });

  it("surfaces the daemon's error envelope as a SandboxError", async () => {
    serveWith(createHandler({ token: "x".repeat(32), routes: [] }));

    await expect(createSandboxClient({ url, token }).health()).rejects.toThrow(
      new SandboxError("unauthorized", "Missing or invalid sandbox token"),
    );
  });

  it("explains how to start the daemon when it is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));

    await expect(createSandboxClient({ url, token }).health()).rejects.toThrow(
      new SandboxUnreachableError(`Sandbox service unreachable at ${url}. Is \`npm run sandboxd\` running?`),
    );
  });

  it("rethrows a caller abort instead of calling it unreachable", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", (_input: string, init: RequestInit) => Promise.reject(init.signal?.reason));

    await expect(createSandboxClient({ url, token }).health(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
