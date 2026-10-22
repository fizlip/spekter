import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { buildGoldenImage, GOLDEN, PROVISION_SCRIPT } from "./image";
import { DEFAULT_IMAGE } from "./lima-yaml";

type Call = { args: string[]; options: SpawnOptions };
let calls: Call[];
let reply: (args: string[]) => { code?: number; stdout?: string; stderr?: string };
let configDir: string;

function spawn(_command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  calls.push({ args: [...args], options });
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdout, stderr });
  const { code = 0, stdout: out, stderr: err } = reply([...args]);
  if (out) stdout.push(out);
  if (err) stderr.push(err);
  stdout.end();
  stderr.end();
  setImmediate(() => child.emit("close", code));
  return child;
}

const build = () =>
  buildGoldenImage({
    limaHome: "/h/lima",
    configDir,
    image: DEFAULT_IMAGE,
    caps: { cpus: 2, memoryGiB: 4, diskGiB: 20 },
    spawn: spawn as never,
    env: { PATH: "/usr/bin", HOME: "/Users/f", SANDBOX_TOKEN: "secret" },
    progress: () => {},
  });

const sub = (call: Call) => call.args.find((arg) => !arg.startsWith("-"));

beforeEach(async () => {
  calls = [];
  configDir = await mkdtemp(join(tmpdir(), "sandbox-image-"));
  reply = () => ({});
});

describe("buildGoldenImage", () => {
  it("creates the golden instance from the generated config with no mounts, provisions it, and leaves it stopped", async () => {
    let config: Record<string, unknown> = {};
    reply = (args) => {
      if (args[0] === "create") config = JSON.parse(readFileSync(args.at(-1)!, "utf-8"));
      return {};
    };

    await build();

    expect(calls.map(sub)).toEqual(["delete", "create", "start", "shell", "stop"]);
    expect(calls[1].args).toContain(`--name=${GOLDEN}`);
    expect(config.mounts).toEqual([]);
    expect(config.portForwards).toHaveLength(2);
    expect(config.propagateProxyEnv).toBe(false);
    expect(calls[3].args.slice(-3)).toEqual(["bash", "-c", PROVISION_SCRIPT]);
    expect(await readdir(configDir)).toEqual([]);
  });

  it("replaces an existing golden instance, so a rebuild converges instead of failing", async () => {
    await build();
    await build();

    expect(calls.filter((call) => sub(call) === "delete").map((call) => call.args)).toEqual([
      ["delete", "-f", "--tty=false", GOLDEN],
      ["delete", "-f", "--tty=false", GOLDEN],
    ]);
  });

  it("passes limactl only PATH, HOME, and LIMA_HOME", async () => {
    await build();

    for (const call of calls) expect(call.options.env).toEqual({ PATH: "/usr/bin", HOME: "/Users/f", LIMA_HOME: "/h/lima" });
  });

  it("fails with the guest's output when provisioning fails, and deletes the half-built instance", async () => {
    reply = (args) => (args[0] === "shell" ? { code: 100, stderr: "E: Unable to locate package nodejs\n" } : {});

    await expect(build()).rejects.toThrow("Unable to locate package nodejs");
    expect(calls.map(sub).at(-1)).toBe("delete");
  });
});

describe("PROVISION_SCRIPT", () => {
  it("installs the common toolset non-interactively and stops on the first failure", () => {
    expect(PROVISION_SCRIPT).toMatch(/^set -eu/);
    expect(PROVISION_SCRIPT).toContain("DEBIAN_FRONTEND=noninteractive");
    for (const tool of ["git", "build-essential", "python3", "nodejs", "npm", "curl"]) expect(PROVISION_SCRIPT).toContain(tool);
  });

  it("is safe to run twice: no appends or one-shot steps", () => {
    expect(PROVISION_SCRIPT).not.toContain(">>");
  });

  it("stops boot from waiting 2 minutes for an eth0 that only exists after cloud-init renames the NIC", () => {
    expect(PROVISION_SCRIPT).toContain("systemd-networkd-wait-online.service.d/zz-spekter.conf");
    expect(PROVISION_SCRIPT).toContain("systemd-networkd-wait-online --any --timeout=15");
  });

  it("resets the machine id so clones running side by side do not share an identity", () => {
    expect(PROVISION_SCRIPT).toContain("truncate -s 0 /etc/machine-id");
  });
});
