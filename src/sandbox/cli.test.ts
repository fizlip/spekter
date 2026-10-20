import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli";

const token = "t".repeat(32);
const box = {
  id: "b1",
  state: "ready",
  createdAt: "2026-10-20T09:00:00.000Z",
  lastActiveAt: "2026-10-20T09:00:00.000Z",
  ttlSeconds: 1800,
  workspaceDir: "/Users/f/spekter-workspace/b1",
  inflightExecs: 0,
};
const execResult = {
  boxId: "b1",
  workspaceDir: "/Users/f/spekter-workspace/b1",
  exitCode: 0,
  stdout: "Linux\n",
  stderr: "",
  timedOut: false,
  truncated: { stdout: false, stderr: false },
  durationMs: 12,
};

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown };
let sent: Sent[];
let respond: (request: Sent) => { status?: number; body: unknown };
let out: string;
let err: string;

beforeEach(() => {
  sent = [];
  out = "";
  err = "";
  respond = () => ({ body: {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const request = {
      method: init.method!,
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    sent.push(request);
    const { status = 200, body } = respond(request);
    return new Response(JSON.stringify(body), { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cli = (...argv: string[]) =>
  runCli(argv, {
    env: { SANDBOX_TOKEN: token, SANDBOX_PORT: "3299" },
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
  });

describe("sandbox CLI", () => {
  it.each([
    [["create", "--name", "b1", "--ttl", "600"], "POST", "/boxes", { name: "b1", ttlSeconds: 600 }],
    [["list"], "GET", "/boxes", undefined],
    [["inspect", "b1"], "GET", "/boxes/b1", undefined],
    [["destroy", "b1"], "DELETE", "/boxes/b1", undefined],
    [["exec", "b1", "--timeout", "30", "--workdir", "/workspace/app", "uname", "-a"], "POST", "/boxes/b1/exec", {
      cmd: "uname -a",
      workdir: "/workspace/app",
      timeoutSeconds: 30,
    }],
  ])("%j hits %s %s with the bearer token", async (argv, method, path, body) => {
    respond = () => ({ body: argv[0] === "list" ? { boxes: [box] } : argv[0] === "exec" ? execResult : box });

    expect(await cli(...argv)).toBe(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method, url: `http://127.0.0.1:3299${path}`, body });
    expect(sent[0].headers.authorization).toBe(`Bearer ${token}`);
  });

  it("passes the command after -- through untouched as one shell string", async () => {
    respond = () => ({ body: execResult });

    await cli("exec", "b1", "--", "echo", "$HOME", "&&", "ls", "--all");

    expect(sent[0].body).toEqual({ cmd: "echo $HOME && ls --all" });
  });

  it("prints the command's own output and exits with its exit code", async () => {
    respond = () => ({ body: { ...execResult, exitCode: 3, stdout: "out\n", stderr: "boom\n" } });

    expect(await cli("exec", "b1", "false")).toBe(3);
    expect(out).toBe("out\n");
    expect(err).toBe("boom\n");
  });

  it("flags a timeout and truncation, and exits 124 like timeout(1)", async () => {
    respond = () => ({
      body: { ...execResult, exitCode: null, stdout: "partial\n", timedOut: true, truncated: { stdout: true, stderr: false } },
    });

    expect(await cli("exec", "b1", "sleep 999")).toBe(124);
    expect(out).toBe("partial\n");
    expect(err).toContain("timed out");
    expect(err).toContain("stdout truncated");
  });

  it("--json prints the raw envelope", async () => {
    respond = () => ({ body: box });

    expect(await cli("inspect", "b1", "--json")).toBe(0);
    expect(JSON.parse(out)).toEqual(box);
  });

  it("prints the daemon's error message and exits non-zero", async () => {
    respond = () => ({ status: 404, body: { error: { code: "not_found", message: "No box named b9" } } });

    expect(await cli("inspect", "b9")).toBe(1);
    expect(err).toContain("No box named b9");
  });

  it("rejects unknown commands and missing arguments with usage, without calling the daemon", async () => {
    expect(await cli("frobnicate")).toBe(2);
    expect(await cli("exec", "b1")).toBe(2);
    expect(await cli("inspect")).toBe(2);
    expect(err).toContain("Usage:");
    expect(sent).toEqual([]);
  });

  it("image build runs the golden-image build locally with the daemon's config, not over HTTP", async () => {
    const builds: unknown[] = [];
    const code = await runCli(["image", "build"], {
      env: { SANDBOX_TOKEN: token, SANDBOX_LIMA_HOME: "/tmp/lh", SANDBOX_CPUS: "3" },
      stdout: (text) => (out += text),
      stderr: (text) => (err += text),
      buildImage: async (options) => {
        builds.push(options);
        options.progress("step one");
      },
    });

    expect(code).toBe(0);
    expect(builds).toEqual([expect.objectContaining({ limaHome: "/tmp/lh", caps: expect.objectContaining({ cpus: 3 }) })]);
    expect(out).toContain("step one");
    expect(sent).toEqual([]);
  });

  it("image without build is a usage error", async () => {
    expect(await cli("image")).toBe(2);
  });

  it("refuses to run without SANDBOX_TOKEN", async () => {
    const code = await runCli(["list"], { env: {}, stdout: () => {}, stderr: (text) => (err += text) });

    expect(code).toBe(1);
    expect(err).toContain("SANDBOX_TOKEN");
    expect(sent).toEqual([]);
  });
});
