import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Env } from "../config";
import { limaConfig, type ImageRef } from "./lima-yaml";
import type { Backend, ExecHandle, Instance, InstanceStatus } from "./types";

const PREFIX = "spekter-sandbox-";
const READY_ATTEMPTS = 5;
const READY_RETRY_MS = 1000;

export type LimaBackendOptions = {
  // Isolated Lima home, so sandbox instances never mix with the user's own Lima VMs.
  limaHome: string;
  // Where per-box configs are written before `limactl create` (daemon-only directory).
  configDir: string;
  image: ImageRef;
  caps: { cpus: number; memoryGiB: number; diskGiB: number };
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  env?: Env;
  sleep?: (ms: number) => Promise<void>;
};

type LimaInstance = { name?: string; status?: string; errors?: string[]; config?: { mounts?: { location?: string }[] } };

const instanceName = (id: string) => `${PREFIX}${id}`;

// limactl logs through logrus; the last msg="..." is the human-readable reason.
function limaError(stderr: string): string {
  const messages = [...stderr.matchAll(/msg="((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
  return messages.at(-1) ?? stderr.trim().split("\n").at(-1) ?? "unknown error";
}

// The command runs as its own process group so a kill takes its children with it; the group's
// PID goes to a guest-local file. Nothing here touches /workspace, which the guest controls
// from the host's point of view.
const pidFile = (execId: string) => `/tmp/spekter-exec/${execId}.pid`;
const wrapper = (execId: string) =>
  `mkdir -p /tmp/spekter-exec && exec setsid -w sh -c 'echo $$ > ${pidFile(execId)} && exec sh -c "$1"' sandbox "$1"`;
const killScript = (execId: string) =>
  `P=$(cat ${pidFile(execId)} 2>/dev/null) || exit 0; kill -TERM -- -$P 2>/dev/null; ` +
  `for i in 1 2 3 4; do kill -0 -- -$P 2>/dev/null || break; sleep 0.5; done; ` +
  `kill -KILL -- -$P 2>/dev/null; rm -f ${pidFile(execId)}; exit 0`;

export function createLimaBackend({
  limaHome,
  configDir,
  image,
  caps,
  spawn = nodeSpawn,
  env = process.env,
  sleep = (ms) => delay(ms).then(() => {}),
}: LimaBackendOptions): Backend {
  // Only what limactl needs: the daemon's own environment carries SANDBOX_TOKEN and other
  // secrets loaded from .env.local, and none of it may reach Lima or a guest.
  const limaEnv: Partial<NodeJS.ProcessEnv> = { PATH: env.PATH, HOME: env.HOME, LIMA_HOME: limaHome };

  function limactl(args: string[], stdio: SpawnOptions["stdio"] = ["ignore", "pipe", "pipe"]): ChildProcess {
    return spawn("limactl", args, { env: limaEnv as NodeJS.ProcessEnv, stdio });
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

  // R28: the box only starts when Lima's effective config mounts exactly its workspace.
  async function assertMounts(id: string, workspaceDir: string) {
    const instance = (await listInstances()).find((entry) => entry.name === instanceName(id));
    const locations = (instance?.config?.mounts ?? []).map((mount) => mount.location);
    if (locations.length !== 1 || locations[0] !== workspaceDir) {
      throw new Error(`Box ${id} has unexpected host mounts (${locations.join(", ") || "none"}); refusing to start it`);
    }
  }

  return {
    async create({ id, workspaceDir }) {
      const name = instanceName(id);
      await mkdir(configDir, { recursive: true });
      const configPath = join(configDir, `${id}.yaml`);
      await writeFile(configPath, JSON.stringify(limaConfig({ workspaceDir, image, ...caps })));
      try {
        await runOrThrow(["create", `--name=${name}`, "--tty=false", configPath]);
      } finally {
        await rm(configPath, { force: true });
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
      const child = limactl(["shell", "--tty=false", "--workdir", workdir, name, "--", "sh", "-c", wrapper(execId), "sandbox", cmd]);
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
          child.kill("SIGTERM");
        },
      };
    },
  };
}
