import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBackend } from "./backend/fake";
import { createBoxRegistry, type BoxRegistry } from "./boxes";
import { MAX_CAPTURE_BYTES } from "./exec";
import { boxRoutes } from "./routes";
import { createHandler, serve } from "./server";

const token = "t".repeat(32);
let fake: ReturnType<typeof createFakeBackend>;
let boxes: BoxRegistry;
let handler: (request: Request) => Promise<Response>;
const events: { event: string; fields?: Record<string, unknown> }[] = [];

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sandboxd-exec-"));
  fake = createFakeBackend();
  events.length = 0;
  const log = async (event: string, fields?: Record<string, unknown>) => {
    events.push({ event, fields });
  };
  boxes = createBoxRegistry({
    backend: fake.backend,
    stateDir: join(dir, "boxes"),
    workspaceRoot: join(dir, "workspace"),
    maxBoxes: 4,
    defaultTtlSeconds: 60,
    log,
  });
  handler = createHandler({
    token,
    routes: boxRoutes({ boxes, backend: fake.backend, log, exec: { defaultSeconds: 90, maxSeconds: 600 } }),
  });
  await boxes.create({ name: "a" });
});

afterEach(() => {
  vi.useRealTimers();
});

function exec(body: unknown, box = "a") {
  return handler(
    new Request(`http://127.0.0.1:3210/boxes/${box}/exec`, {
      method: "POST",
      headers: { host: "127.0.0.1:3210", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /boxes/:id/exec", () => {
  it("returns the full envelope with separated streams", async () => {
    fake.hooks.exec = (process, request) => {
      expect(request).toEqual({ cmd: "echo hi; echo oops >&2; exit 3", workdir: "/workspace" });
      process.stdout.write("hi\n");
      process.stderr.write("oops\n");
      process.exit(3);
    };

    const response = await exec({ cmd: "echo hi; echo oops >&2; exit 3" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      boxId: "a",
      exitCode: 3,
      stdout: "hi\n",
      stderr: "oops\n",
      timedOut: false,
      truncated: { stdout: false, stderr: false },
      durationMs: expect.any(Number),
    });
    expect(events.at(-1)).toMatchObject({ event: "exec", fields: { boxId: "a", exitCode: 3, outcome: "exited" } });
  });

  it("passes a working directory through", async () => {
    fake.hooks.exec = (process, request) => {
      expect(request.workdir).toBe("/workspace/app");
      process.exit(0);
    };

    expect((await exec({ cmd: "ls", workdir: "/workspace/app" })).status).toBe(200);
  });

  it("kills a command that outlives its timeout and returns its partial output", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fake.hooks.exec = (process) => {
      process.stdout.write("building step 1\n");
    };

    const pending = exec({ cmd: "make", timeoutSeconds: 5 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await (await pending).json();

    expect(result).toMatchObject({ exitCode: null, timedOut: true, stdout: "building step 1\n" });
    expect(fake.calls).toContain("kill a");
    expect(events.at(-1)).toMatchObject({ event: "exec", fields: { outcome: "timeout" } });
  });

  it("keeps the head and tail of oversized output and flags the stream as truncated", async () => {
    const big = `START${"x".repeat(1_000_000)}END`;
    fake.hooks.exec = (process) => {
      process.stdout.write(big);
      process.exit(0);
    };

    const result = await (await exec({ cmd: "cat big.log" })).json();

    expect(result.truncated).toEqual({ stdout: true, stderr: false });
    expect(result.stdout.startsWith("START")).toBe(true);
    expect(result.stdout.endsWith("END")).toBe(true);
    expect(result.stdout).toContain(`[... ${big.length - MAX_CAPTURE_BYTES} bytes omitted ...]`);
    expect(result.stdout.length).toBeLessThan(MAX_CAPTURE_BYTES + 100);
  });

  it("refuses a timeout above the daemon ceiling", async () => {
    const response = await exec({ cmd: "sleep 1", timeoutSeconds: 601 });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("600");
  });

  it("names the live boxes when the box is unknown", async () => {
    const response = await exec({ cmd: "ls" }, "gone");

    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe('No box "gone". Live boxes: a');
  });

  it("refreshes the box's idle clock and releases its in-flight count", async () => {
    await exec({ cmd: "true" });

    expect(boxes.get("a").inflightExecs).toBe(0);
  });
});

describe("client disconnect", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
  });

  // The one bound-socket test: only a real connection can drop mid-request.
  it("kills the guest command when the caller goes away", async () => {
    fake.hooks.exec = () => {};
    server = await serve(handler, 0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();

    const request = fetch(`http://127.0.0.1:${port}/boxes/a/exec`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ cmd: "sleep 1000" }),
      signal: controller.signal,
    }).catch(() => null);
    await vi.waitFor(() => expect(fake.calls).toContain("exec a sleep 1000"));
    controller.abort();
    await request;

    await vi.waitFor(() => expect(fake.calls).toContain("kill a"));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ event: "exec", fields: { outcome: "client_disconnect" } }));
  });
});
