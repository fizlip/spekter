import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Env } from "../config";
import { limaConfig, type ImageRef, type LimaConfigInput } from "./lima-yaml";
import type { Backend, ExecHandle, Instance, InstanceStatus } from "./types";

// Kept short: the instance name is part of Lima's socket path (see limaHomeFits).
export const PREFIX = "spekter-";
// The stopped clone source built by `sandbox image build`. Outside PREFIX, so it is never
// listed as a box and reconciliation never adopts or deletes it.
export const GOLDEN = "golden";
// Lima's longest socket: <LIMA_HOME>/<instance>/ssh.sock.<16 digits>, under macOS's 104-byte cap.
const UNIX_PATH_MAX = 104;
const LONGEST_SOCKET_SUFFIX = "/ssh.sock.1234567890123456";

export function limaHomeFits(limaHome: string, maxIdLength: number): boolean {
  return `${limaHome}/${PREFIX}${"x".repeat(maxIdLength)}${LONGEST_SOCKET_SUFFIX}`.length < UNIX_PATH_MAX;
}
const READY_ATTEMPTS = 5;
const READY_RETRY_MS = 1000;
const WORKSPACE_MOUNT_POINT = "/workspace";

export type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
export type Caps = { cpus: number; memoryGiB: number; diskGiB: number };

export type LimaBackendOptions = {
  // Isolated Lima home, so sandbox instances never mix with the user's own Lima VMs.
  limaHome: string;
  // Where per-box configs are written before `limactl create` (daemon-only directory).
  configDir: string;
  image: ImageRef;
  caps: Caps;
  spawn?: Spawn;
  env?: Env;
  sleep?: (ms: number) => Promise<void>;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
};

type LimaInstance = {
  name?: string;
  status?: string;
  errors?: string[];
  config?: { mounts?: { location?: string; mountPoint?: string }[] };
};

const instanceName = (id: string) => `${PREFIX}${id}`;

// limactl logs through logrus; the last msg="..." is the human-readable reason.
export function limaError(stderr: string): string {
  const messages = [...stderr.matchAll(/msg="((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
  return messages.at(-1) ?? stderr.trim().split("\n").at(-1) ?? "unknown error";
}

// The one way sandbox code runs limactl: argv only, never a shell, and only the environment
// limactl needs — the daemon's own carries SANDBOX_TOKEN and other secrets from .env.local.
export function limactlRunner({ limaHome, spawn = nodeSpawn, env = process.env }: { limaHome: string; spawn?: Spawn; env?: Env }) {
  const limaEnv: Partial<NodeJS.ProcessEnv> = { PATH: env.PATH, HOME: env.HOME, LIMA_HOME: limaHome };

  function limactl(args: string[], extra: SpawnOptions = {}): ChildProcess {
    return spawn("limactl", args, { env: limaEnv as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], ...extra });
  }

  function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = limactl(args);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => (stdout += chunk));
      child.stderr?.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  async function runOrThrow(args: string[]) {
    const result = await run(args);
    if (result.code !== 0) throw new Error(`limactl ${args[0]} failed: ${limaError(result.stderr)}`);
    return result;
  }

  async function listInstances(): Promise<LimaInstance[]> {
    const { stdout } = await runOrThrow(["list", "--json", "--tty=false"]);
    return stdout
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as LimaInstance);
  }

  // Writes the generated config, creates the instance from it, and removes the file again.
  async function createFromConfig(name: string, configDir: string, config: LimaConfigInput) {
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, `${name}.yaml`);
    await writeFile(configPath, JSON.stringify(limaConfig(config)));
    try {
      await runOrThrow(["create", `--name=${name}`, "--tty=false", configPath]);
    } finally {
      await rm(configPath, { force: true });
    }
  }

  return { limactl, run, runOrThrow, listInstances, createFromConfig };
}

// The command runs as its own process group so a kill takes its children with it; the group's
// PID goes to a guest-local file. Nothing here touches /workspace, which the guest controls
// from the host's point of view.
const pidFile = (execId: string) => `/tmp/spekter-exec/${execId}.pid`;
const wrapper = (execId: string) =>
  `mkdir -p /tmp/spekter-exec && exec setsid -w sh -c 'echo $$ > ${pidFile(execId)} && exec sh -c "$1"' sandbox "$1"`;
// No "--" before the negative PID: the guest's /bin/sh is dash, whose kill rejects it.
const killScript = (execId: string) =>
  `P=$(cat ${pidFile(execId)} 2>/dev/null) || exit 0; kill -TERM -$P 2>/dev/null; ` +
  `for i in 1 2 3 4; do kill -0 -$P 2>/dev/null || break; sleep 0.5; done; ` +
  `kill -KILL -$P 2>/dev/null; rm -f ${pidFile(execId)}; exit 0`;

function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

export function createLimaBackend({
  limaHome,
  configDir,
  image,
  caps,
  spawn = nodeSpawn,
  env = process.env,
  sleep = (ms) => delay(ms).then(() => {}),
  killGroup = killProcessGroup,
}: LimaBackendOptions): Backend {
  const { limactl, run, runOrThrow, listInstances, createFromConfig } = limactlRunner({ limaHome, spawn, env });

  // R28: the box only starts when Lima's effective config mounts exactly its workspace, at /workspace.
  async function assertMounts(id: string, workspaceDir: string) {
    const instance = (await listInstances()).find((entry) => entry.name === instanceName(id));
    const mounts = instance?.config?.mounts ?? [];
    if (mounts.length !== 1 || mounts[0].location !== workspaceDir || mounts[0].mountPoint !== WORKSPACE_MOUNT_POINT) {
      const found = mounts.map((mount) => `${mount.location} -> ${mount.mountPoint}`).join(", ") || "none";
      throw new Error(`Box ${id} has unexpected host mounts (${found}); refusing to start it`);
    }
  }

  return {
    async create({ id, workspaceDir }) {
      const name = instanceName(id);
      const golden = (await listInstances()).find((entry) => entry.name === GOLDEN);
      if (golden?.status === "Stopped") {
        // APFS clonefile copy of a provisioned disk: no image conversion, no package installs.
        // The golden config mounts nothing; --set gives the clone its one workspace mount.
        const mount = JSON.stringify([{ location: workspaceDir, mountPoint: WORKSPACE_MOUNT_POINT, writable: true }]);
        // CPU and memory follow the current config; the disk cannot shrink below the golden's.
        await runOrThrow([
          "clone",
          GOLDEN,
          name,
          "--tty=false",
          `--cpus=${caps.cpus}`,
          `--memory=${caps.memoryGiB}`,
          "--set",
          `.mounts = ${mount}`,
        ]);
      } else {
        await createFromConfig(name, configDir, { workspaceDir, image, ...caps });
      }
      await assertMounts(id, workspaceDir);
      await runOrThrow(["start", "--tty=false", name]);

      // `limactl start` returns at READY, but the first SSH session can still race the port.
      for (let attempt = 1; ; attempt++) {
        if ((await run(["shell", "--tty=false", name, "--", "true"])).code === 0) return;
        if (attempt === READY_ATTEMPTS) throw new Error(`Box ${id} started but never accepted a shell`);
        await sleep(READY_RETRY_MS);
      }
    },

    async destroy(id) {
      const name = instanceName(id);
      await run(["stop", "-f", "--tty=false", name]);
      const result = await run(["delete", "-f", "--tty=false", name]);
      if (result.code !== 0 && (await listInstances()).some((entry) => entry.name === name)) {
        throw new Error(`limactl delete failed: ${limaError(result.stderr)}`);
      }
    },

    async list(): Promise<Instance[]> {
      return (await listInstances())
        .filter((entry) => entry.name?.startsWith(PREFIX))
        .map((entry) => {
          const status: InstanceStatus =
            entry.status === "Broken" || entry.errors?.length ? "broken" : entry.status === "Running" ? "running" : "stopped";
          return { id: entry.name!.slice(PREFIX.length), status };
        });
    },

    exec(id, { cmd, workdir }): ExecHandle {
      const name = instanceName(id);
      const execId = randomBytes(8).toString("hex");
      // Own process group: limactl forks ssh, and killing limactl alone orphans that ssh, which
      // keeps the output pipes open so the exec never closes.
      const child = limactl(["shell", "--tty=false", "--workdir", workdir, name, "--", "sh", "-c", wrapper(execId), "sandbox", cmd], {
        detached: true,
      });
      const exited = new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code));
        child.on("error", () => resolve(null));
      });
      return {
        stdout: child.stdout!,
        stderr: child.stderr!,
        exited,
        // Killing the local ssh client alone would orphan a silent command: with no PTY, the
        // guest never sees a hangup. So kill the process group inside the guest first.
        kill: async () => {
          await run(["shell", "--tty=false", name, "--", "sh", "-c", killScript(execId)]);
          if (child.pid === undefined) child.kill("SIGTERM");
          else killGroup(child.pid, "SIGTERM");
        },
      };
    },
  };
}
