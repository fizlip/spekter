import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiSdkLoop } from "../agent/ai-sdk-loop";
import { assembleChatCall } from "../chat/complete";
import { DEFAULT_MAX_STEPS } from "../config";
import { scriptedModel, toolCallContent } from "../testing/mock-model";
import { builtinTools } from "./registry";
import { sandboxDestroyTool } from "./sandbox-destroy";
import { MAX_EXEC_SECONDS, MAX_TOOL_OUTPUT_CHARS, sandboxExecTool } from "./sandbox-exec";

const token = "t".repeat(32);
const workspaceDir = "/Users/f/spekter-workspace/b1";
const box = { id: "b1", state: "ready", workspaceDir, ttlSeconds: 1800 };
const execResult = {
  boxId: "b1",
  workspaceDir,
  exitCode: 0,
  stdout: "hello\n",
  stderr: "",
  timedOut: false,
  truncated: { stdout: false, stderr: false },
  durationMs: 9,
};

type Sent = { method: string; path: string; body: unknown; signal?: AbortSignal | null };
let sent: Sent[];
let respond: (request: Sent) => { status?: number; body: unknown } | Promise<never>;

beforeEach(() => {
  sent = [];
  vi.stubEnv("SANDBOX_TOKEN", token);
  vi.stubEnv("SANDBOX_PORT", "3299");
  respond = ({ method, path }) => ({
    status: method === "POST" && path === "/boxes" ? 201 : 200,
    body: path.endsWith("/exec") ? execResult : method === "DELETE" ? { id: "b1", destroyed: true } : box,
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const request = {
      method: init.method!,
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      signal: init.signal,
    };
    sent.push(request);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    const answer = await respond(request);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sandbox_exec", () => {
  it("creates a box when none is given and returns its id and absolute host workspace", async () => {
    const result = await sandboxExecTool.execute({ cmd: "echo hello" }, {});

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /boxes", "POST /boxes/b1/exec"]);
    expect(result).toMatchObject({ box: "b1", workspaceDir, exitCode: 0, stdout: "hello\n", timedOut: false });
  });

  it("reuses a given box and always sends an explicit, bounded timeout", async () => {
    await sandboxExecTool.execute({ cmd: "make", box: "b1", workdir: "/workspace/app" }, {});
    await sandboxExecTool.execute({ cmd: "make", box: "b1", timeoutSeconds: 10_000 }, {});

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /boxes/b1/exec", "POST /boxes/b1/exec"]);
    expect(sent[0].body).toEqual({ cmd: "make", workdir: "/workspace/app", timeoutSeconds: expect.any(Number) });
    expect((sent[0].body as { timeoutSeconds: number }).timeoutSeconds).toBeLessThanOrEqual(MAX_EXEC_SECONDS);
    expect((sent[1].body as { timeoutSeconds: number }).timeoutSeconds).toBe(MAX_EXEC_SECONDS);
  });

  it("passes a timed-out result through with its partial output instead of failing", async () => {
    respond = () => ({ body: { ...execResult, exitCode: null, stdout: "partial", timedOut: true } });

    expect(await sandboxExecTool.execute({ cmd: "sleep 999", box: "b1" }, {})).toMatchObject({
      timedOut: true,
      exitCode: null,
      stdout: "partial",
    });
  });

  it("trims oversized output to fit the model's context, keeping both ends and marking the cut", async () => {
    const huge = `START${"x".repeat(MAX_TOOL_OUTPUT_CHARS * 3)}END`;
    respond = () => ({ body: { ...execResult, stdout: huge } });

    const result = await sandboxExecTool.execute({ cmd: "cat big", box: "b1" }, {});

    expect(result.stdout.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 100);
    expect(result.stdout.startsWith("START")).toBe(true);
    expect(result.stdout.endsWith("END")).toBe(true);
    expect(result.stdout).toContain("[TRUNCATED");
    expect(result.truncated.stdout).toBe(true);
  });

  it("turns a stale box id into an error naming the live boxes and how to recover", async () => {
    respond = () => ({ status: 404, body: { error: { code: "not_found", message: 'No box "old". Live boxes: b2' } } });

    await expect(sandboxExecTool.execute({ cmd: "ls", box: "old" }, {})).rejects.toThrow(
      /No box "old"\. Live boxes: b2[^]*omit `box`/,
    );
  });

  it("passes the box-limit error through with the live ids, so the agent can reuse or destroy one", async () => {
    respond = () => ({
      status: 409,
      body: { error: { code: "conflict", message: "Box limit reached (2 live boxes: a, b). Reuse one of them, or destroy one first" } },
    });

    await expect(sandboxExecTool.execute({ cmd: "ls" }, {})).rejects.toThrow("live boxes: a, b");
  });

  it("explains how to start the daemon when it is unreachable", async () => {
    respond = () => Promise.reject(new TypeError("fetch failed"));

    await expect(sandboxExecTool.execute({ cmd: "ls", box: "b1" }, {})).rejects.toThrow("npm run sandboxd");
  });

  it("says the sandbox is not configured when SANDBOX_TOKEN is missing", async () => {
    vi.stubEnv("SANDBOX_TOKEN", "");

    await expect(sandboxExecTool.execute({ cmd: "ls" }, {})).rejects.toThrow("SANDBOX_TOKEN");
    expect(sent).toEqual([]);
  });

  it("works with no caller signal (the non-stream route) and still bounds the call", async () => {
    await sandboxExecTool.execute({ cmd: "ls", box: "b1" }, {});

    expect(sent[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels the call when the caller aborts, so the daemon kills the command", async () => {
    const controller = new AbortController();
    respond = ({ signal }) =>
      new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));

    const running = sandboxExecTool.execute({ cmd: "sleep 999", box: "b1" }, { abortSignal: controller.signal });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("teaches the lifecycle and warns that box content is untrusted", () => {
    expect(sandboxExecTool.description).toMatch(/box/);
    expect(sandboxExecTool.description).toMatch(/untrusted/i);
    expect(sandboxExecTool.description).toMatch(/sandbox_destroy/);
  });
});

describe("sandbox tools in the agent loop", () => {
  it("creates, reuses the returned box, and destroys it within the default step budget", async () => {
    const model = scriptedModel([
      { content: [toolCallContent("sandbox_exec", "c1", JSON.stringify({ cmd: "pip install requests" }))], finishReason: "tool-calls" },
      {
        content: [toolCallContent("sandbox_exec", "c2", JSON.stringify({ cmd: "python3 main.py", box: "b1" }))],
        finishReason: "tool-calls",
      },
      { content: [toolCallContent("sandbox_destroy", "c3", JSON.stringify({ box: "b1" }))], finishReason: "tool-calls" },
      { content: [{ type: "text", text: "Done: the script printed hello." }] },
    ]);

    const result = await aiSdkLoop.complete(assembleChatCall([{ role: "user", content: "Run it." }], model), {
      tools: builtinTools,
      maxSteps: DEFAULT_MAX_STEPS,
    });

    expect(result.text).toBe("Done: the script printed hello.");
    expect(result.toolCalls.map(({ name, ok }) => `${name}:${ok}`)).toEqual([
      "sandbox_exec:true",
      "sandbox_exec:true",
      "sandbox_destroy:true",
    ]);
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /boxes",
      "POST /boxes/b1/exec",
      "POST /boxes/b1/exec",
      "DELETE /boxes/b1",
    ]);
  });
});

describe("sandbox_destroy", () => {
  it("destroys the box and says its workspace is kept", async () => {
    const result = await sandboxDestroyTool.execute({ box: "b1" }, {});

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["DELETE /boxes/b1"]);
    expect(result).toEqual({ box: "b1", destroyed: true, note: expect.stringContaining("kept") });
  });

  it("reports an unknown box with the live ones", async () => {
    respond = () => ({ status: 404, body: { error: { code: "not_found", message: 'No box "old". Live boxes: none' } } });

    await expect(sandboxDestroyTool.execute({ box: "old" }, {})).rejects.toThrow('No box "old"');
  });
});
