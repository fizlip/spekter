import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { createLimaBackend } from "./lima";
import { DEFAULT_IMAGE } from "./lima-yaml";

type Reply = { code?: number | null; stdout?: string; stderr?: string } | "hang";
type Call = { command: string; args: string[]; options: SpawnOptions; child: FakeChild };
type FakeChild = ChildProcess & { finish(code: number | null): void; signals: string[] };

let calls: Call[];
let reply: (args: string[]) => Reply;
let configDir: string;
const sleeps: number[] = [];

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdout, stderr, signals: [] });
  child.finish = (code) => {
    stdout.end();
    stderr.end();
    setImmediate(() => child.emit("close", code));
  };
  child.kill = (signal) => {
    child.signals.push(String(signal));
    child.finish(null);
    return true;
  };
  return child;
}

function spawn(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  const child = fakeChild();
  calls.push({ command, args: [...args], options, child });
  const answer = reply([...args]);
  if (answer !== "hang") {
    if (answer.stdout) child.stdout!.push(answer.stdout);
    if (answer.stderr) child.stderr!.push(answer.stderr);
    child.finish(answer.code ?? 0);
  }
  return child;
}

const listing = (...instances: object[]) => instances.map((instance) => JSON.stringify(instance)).join("\n");
const mountsOf = (...locations: string[]) => ({ mounts: locations.map((location) => ({ location, mountPoint: "/workspace" })) });

function backend() {
  return createLimaBackend({
    limaHome: "/repo/.sandbox/lima",
    configDir,
    image: DEFAULT_IMAGE,
    caps: { cpus: 2, memoryGiB: 4, diskGiB: 20 },
    spawn: spawn as never,
    env: { PATH: "/usr/bin", HOME: "/Users/f", SANDBOX_TOKEN: "secret", OPENROUTER_API_KEY: "sk-secret", HTTPS_PROXY: "http://u:p@proxy" },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
}

const sub = (call: Call) => call.args.filter((arg) => !arg.startsWith("--"))[0];

beforeEach(async () => {
  calls = [];
  sleeps.length = 0;
  configDir = await mkdtemp(join(tmpdir(), "sandboxd-lima-"));
  reply = (args) =>
    args[0] === "list"
      ? { stdout: listing({ name: "spekter-b1", status: "Running", config: mountsOf("/ws/b1") }) }
      : {};
});

describe("Lima backend", () => {
  it("runs limactl non-interactively with only PATH, HOME, and LIMA_HOME — never a shell or the daemon's secrets", async () => {
    await backend().create({ id: "b1", workspaceDir: "/ws/b1" });

    for (const call of calls) {
      expect(call.command).toBe("limactl");
      expect(call.args).toContain("--tty=false");
      expect(call.options.env).toEqual({ PATH: "/usr/bin", HOME: "/Users/f", LIMA_HOME: "/repo/.sandbox/lima" });
      expect(call.options.shell).toBeUndefined();
    }
  });

  it("creates from a generated config, checks the mounts, starts, and waits for a working shell", async () => {
    let config: Record<string, unknown> = {};
    reply = (args) => {
      // Read while create runs: the config file is removed once the box is up.
      if (args[0] === "create") config = JSON.parse(readFileSync(args.at(-1)!, "utf-8"));
      return args[0] === "list" ? { stdout: listing({ name: "spekter-b1", status: "Stopped", config: mountsOf("/ws/b1") }) } : {};
    };

    await backend().create({ id: "b1", workspaceDir: "/ws/b1" });

    expect(calls.map(sub)).toEqual(["list", "create", "list", "start", "shell"]);
    expect(calls[1].args).toContain("--name=spekter-b1");
    expect(config.mounts).toEqual([{ location: "/ws/b1", mountPoint: "/workspace", writable: true }]);
    expect(await readdir(configDir)).toEqual([]);
  });

  it("clones a stopped golden instance with exactly the box's workspace mount, instead of a cold create", async () => {
    reply = (args) =>
      args[0] === "list"
        ? {
            stdout: listing(
              { name: "golden", status: "Stopped", config: { mounts: [] } },
              { name: "spekter-b1", status: "Stopped", config: mountsOf("/ws/b1") },
            ),
          }
        : {};

    await backend().create({ id: "b1", workspaceDir: "/ws/b1" });

    expect(calls.map(sub)).toEqual(["list", "clone", "list", "start", "shell"]);
    const clone = calls[1].args;
    expect(clone.slice(0, 3)).toEqual(["clone", "golden", "spekter-b1"]);
    const set = clone[clone.indexOf("--set") + 1];
    expect(set).toBe('.mounts = [{"location":"/ws/b1","mountPoint":"/workspace","writable":true}]');
    // The configured size applies, not whatever the golden image was built with.
    expect(clone).toEqual(expect.arrayContaining(["--cpus=2", "--memory=4"]));
  });

  it("falls back to a cold create when there is no stopped golden instance", async () => {
    reply = (args) =>
      args[0] === "list"
        ? { stdout: listing({ name: "golden", status: "Running" }, { name: "spekter-b1", status: "Stopped", config: mountsOf("/ws/b1") }) }
        : {};

    await backend().create({ id: "b1", workspaceDir: "/ws/b1" });

    expect(calls.map(sub)).toEqual(["list", "create", "list", "start", "shell"]);
  });

  it("never reports the golden instance as a box, so reconciliation leaves it alone", async () => {
    reply = () => ({ stdout: listing({ name: "golden", status: "Stopped" }, { name: "spekter-a", status: "Running" }) });

    expect(await backend().list()).toEqual([{ id: "a", status: "running" }]);
  });

  it.each([
    ["an extra home-folder mount", mountsOf("/ws/b1", "/Users/f")],
    ["a missing workspace mount", mountsOf()],
    ["the workspace at the wrong guest path", { mounts: [{ location: "/ws/b1", mountPoint: "/ws/b1" }] }],
  ])("refuses to start a box whose effective config has %s", async (_label, config) => {
    reply = (args) => (args[0] === "list" ? { stdout: listing({ name: "spekter-b1", status: "Stopped", config }) } : {});

    await expect(backend().create({ id: "b1", workspaceDir: "/ws/b1" })).rejects.toThrow("unexpected host mounts");
    expect(calls.map(sub)).not.toContain("start");
  });

  it("reports limactl's own error message when start fails", async () => {
    const base = reply;
    reply = (args) =>
      args[0] === "start" ? { code: 1, stderr: 'time="x" level=fatal msg="vz: memory allocation failed"\n' } : base(args);

    await expect(backend().create({ id: "b1", workspaceDir: "/ws/b1" })).rejects.toThrow("limactl start failed: vz: memory allocation failed");
  });

  it("retries the first shell briefly for the post-ready SSH race", async () => {
    let shells = 0;
    const base = reply;
    reply = (args) => (args[0] === "shell" ? { code: ++shells < 3 ? 255 : 0 } : base(args));

    await backend().create({ id: "b1", workspaceDir: "/ws/b1" });

    expect(shells).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("execs the command verbatim as one argument, so only the guest shell interprets it", async () => {
    reply = () => ({ code: 7, stdout: "out", stderr: "err" });
    const cmd = "echo $(whoami); rm -rf / --no-preserve-root && `id`";

    const handle = backend().exec("b1", { cmd, workdir: "/workspace/app" });

    const args = calls[0].args;
    expect(args.slice(0, 6)).toEqual(["shell", "--tty=false", "--workdir", "/workspace/app", "spekter-b1", "--"]);
    expect(args.at(-1)).toBe(cmd);
    expect(calls[0].options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(await handle.exited).toBe(7);
  });

  it("records the command's PID inside the guest and kills it there, never via the host workspace", async () => {
    reply = (args) => (args.includes("sleep 1000") ? "hang" : {});
    const handle = backend().exec("b1", { cmd: "sleep 1000", workdir: "/workspace" });
    const wrapper = calls[0].args.join(" ");

    await handle.kill();

    const killScript = calls[1].args.join(" ");
    const pidFile = wrapper.match(/\/tmp\/spekter-exec\/[0-9a-f]+\.pid/)?.[0];
    expect(pidFile).toBeDefined();
    expect(killScript).toContain(pidFile);
    // The guest's /bin/sh is dash, whose kill rejects a "--" separator and kills nothing.
    expect(killScript).toContain("kill -TERM -$P");
    expect(killScript).not.toContain("kill -TERM --");
    expect(`${wrapper} ${killScript}`).not.toContain("/workspace/");
    expect(await handle.exited).toBeNull();
  });

  it("runs each exec in its own host process group and kills the whole group, so no orphaned ssh holds it open", async () => {
    reply = (args) => (args.includes("sleep 1000") ? "hang" : {});
    const killed: [number, string][] = [];
    const handle = createLimaBackend({
      limaHome: "/repo/.sandbox/lima",
      configDir,
      image: DEFAULT_IMAGE,
      caps: { cpus: 2, memoryGiB: 4, diskGiB: 20 },
      spawn: ((command: string, args: string[], options: SpawnOptions) => {
        const child = spawn(command, args, options);
        Object.defineProperty(child, "pid", { value: 4242 });
        return child;
      }) as never,
      env: { PATH: "/usr/bin", HOME: "/Users/f" },
      killGroup: (pid, signal) => {
        killed.push([pid, signal]);
        calls[0].child.finish(null);
      },
    }).exec("b1", { cmd: "sleep 1000", workdir: "/workspace" });

    await handle.kill();

    expect(calls[0].options.detached).toBe(true);
    expect(killed).toEqual([[4242, "SIGTERM"]]);
    expect(await handle.exited).toBeNull();
  });

  it("tears down with a forced stop, then a forced delete", async () => {
    await backend().destroy("b1");

    expect(calls.map((call) => call.args.filter((arg) => arg !== "--tty=false"))).toEqual([
      ["stop", "-f", "spekter-b1"],
      ["delete", "-f", "spekter-b1"],
    ]);
  });

  it("lists only sandbox instances, mapping Lima's status", async () => {
    reply = () => ({
      stdout: listing(
        { name: "spekter-a", status: "Running" },
        { name: "spekter-b", status: "Broken" },
        { name: "spekter-c", status: "Running", errors: ["hostagent died"] },
        { name: "spekter-d", status: "Stopped" },
        { name: "filips-own-vm", status: "Running" },
      ),
    });

    expect(await backend().list()).toEqual([
      { id: "a", status: "running" },
      { id: "b", status: "broken" },
      { id: "c", status: "broken" },
      { id: "d", status: "stopped" },
    ]);
  });

  it("reads an empty instance list from limactl's no-instances warning", async () => {
    reply = () => ({ stderr: 'level=warning msg="No instance found."' });

    expect(await backend().list()).toEqual([]);
  });
});
