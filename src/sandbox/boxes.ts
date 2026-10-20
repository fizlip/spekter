import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Backend } from "./backend/types";
import type { EventLog } from "./log";
import { SandboxError } from "./wire";

export type BoxState = "creating" | "ready" | "destroying";

export type BoxInfo = {
  id: string;
  state: BoxState;
  createdAt: string;
  lastActiveAt: string;
  ttlSeconds: number;
  workspaceDir: string;
  inflightExecs: number;
};

type Box = {
  id: string;
  state: BoxState;
  createdAt: number;
  lastActiveAt: number;
  ttlSeconds: number;
  workspaceDir: string;
  inflightExecs: number;
};

// What survives a daemon restart; written before the backend is asked to boot anything.
type StateFile = { id: string; ttlSeconds: number; createdAt: string; workspaceDir: string };

export type BoxRegistryOptions = {
  backend: Backend;
  stateDir: string;
  workspaceRoot: string;
  maxBoxes: number;
  defaultTtlSeconds: number;
  log: EventLog;
  now?: () => number;
};

// Short on purpose: ids end up inside Lima's socket paths, which macOS caps at 104 characters.
export const MAX_BOX_ID_LENGTH = 20;
const BOX_ID = new RegExp(`^[a-z0-9][a-z0-9-]{0,${MAX_BOX_ID_LENGTH - 1}}$`);

// Ids become file names, Lima instance names, and registry keys, so only a strict
// charset ever reaches them — a separator or ".." is a 400, never a path escape.
export function assertBoxId(id: string): string {
  if (!BOX_ID.test(id)) {
    throw new SandboxError(
      "invalid_request",
      `Invalid box name "${id}": use lowercase letters, digits, and dashes (max ${MAX_BOX_ID_LENGTH})`,
    );
  }
  return id;
}

export function createBoxRegistry({ backend, stateDir, workspaceRoot, maxBoxes, defaultTtlSeconds, log, now = Date.now }: BoxRegistryOptions) {
  const boxes = new Map<string, Box>();
  const locks = new Map<string, Promise<unknown>>();
  const statePath = (id: string) => join(stateDir, `${id}.json`);

  const info = (box: Box): BoxInfo => ({
    ...box,
    createdAt: new Date(box.createdAt).toISOString(),
    lastActiveAt: new Date(box.lastActiveAt).toISOString(),
  });

  // Lifecycle operations on one box run one at a time; different boxes never wait on each other.
  function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
    locks.set(id, run.catch(() => {}));
    return run;
  }

  function find(id: string): Box {
    const box = boxes.get(id);
    if (box) return box;
    const live = [...boxes.keys()];
    throw new SandboxError(
      "not_found",
      `No box "${id}". ${live.length ? `Live boxes: ${live.join(", ")}` : "There are no live boxes."}`,
    );
  }

  async function destroyLocked(box: Box, reason: string, extra: Record<string, unknown> = {}) {
    box.state = "destroying";
    try {
      await backend.destroy(box.id);
    } catch (error) {
      box.state = "ready";
      throw error;
    }
    boxes.delete(box.id);
    await rm(statePath(box.id), { force: true });
    await log("box.destroy", { boxId: box.id, reason, lifetimeMs: now() - box.createdAt, ...extra });
  }

  const isIdle = (box: Box) => box.state === "ready" && box.inflightExecs === 0 && now() - box.lastActiveAt > box.ttlSeconds * 1000;

  return {
    async create({ name, ttlSeconds = defaultTtlSeconds }: { name?: string; ttlSeconds?: number }): Promise<BoxInfo> {
      const id = name === undefined ? randomBytes(4).toString("hex") : assertBoxId(name);
      if (boxes.has(id)) throw new SandboxError("conflict", `A box named "${id}" already exists`);
      if (boxes.size >= maxBoxes) {
        throw new SandboxError("conflict", `Box limit reached (${maxBoxes} live boxes); destroy one first`);
      }

      const createdAt = now();
      const box: Box = { id, state: "creating", createdAt, lastActiveAt: createdAt, ttlSeconds, workspaceDir: join(workspaceRoot, id), inflightExecs: 0 };
      boxes.set(id, box);
      await log("box.create", { boxId: id, ttlSeconds });

      try {
        await mkdir(stateDir, { recursive: true });
        const state: StateFile = { id, ttlSeconds, createdAt: new Date(createdAt).toISOString(), workspaceDir: box.workspaceDir };
        await writeFile(statePath(id), JSON.stringify(state));
        await mkdir(box.workspaceDir, { recursive: true });
        await backend.create({ id, workspaceDir: box.workspaceDir });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await backend.destroy(id).catch(() => {});
        await rm(statePath(id), { force: true });
        boxes.delete(id);
        await log("box.failed", { boxId: id, error: message });
        throw new SandboxError("internal_error", `Box "${id}" failed to start: ${message}`);
      }

      box.state = "ready";
      box.lastActiveAt = now();
      await log("box.ready", { boxId: id, bootMs: box.lastActiveAt - createdAt });
      return info(box);
    },

    get: (id: string): BoxInfo => info(find(id)),

    list: (): BoxInfo[] => [...boxes.values()].map(info),

    destroy: async (id: string): Promise<void> => {
      const box = find(id);
      return withLock(id, () => destroyLocked(box, "destroyed"));
    },

    // Counts a running command against the box so the reaper never sees it as idle, and
    // refreshes its idle clock when the command starts and when it ends.
    async runExec<T>(id: string, fn: (box: BoxInfo) => Promise<T>): Promise<T> {
      const box = find(id);
      if (box.state !== "ready") throw new SandboxError("conflict", `Box "${id}" is ${box.state}, not ready`);
      box.inflightExecs += 1;
      box.lastActiveAt = now();
      try {
        return await fn(info(box));
      } finally {
        box.inflightExecs -= 1;
        box.lastActiveAt = now();
      }
    },

    // Candidates are chosen first, then each is re-checked under its lock right before
    // destroy, so a command that started in between wins and the box survives.
    async reap(): Promise<void> {
      const candidates = [...boxes.values()].filter(isIdle);
      await Promise.all(
        candidates.map((box) =>
          withLock(box.id, async () => {
            if (boxes.get(box.id) !== box || !isIdle(box)) return;
            await destroyLocked(box, "ttl", { idleMs: now() - box.lastActiveAt });
          }).catch((error) => console.error(`Failed to reap box ${box.id}`, error)),
        ),
      );
    },

    startReaper(intervalMs: number): () => void {
      const timer = setInterval(() => void this.reap(), intervalMs);
      return () => clearInterval(timer);
    },

    // Matches what the backend is running against the state files a previous daemon left:
    // boxes with state are adopted with a fresh idle clock; instances without state, broken
    // instances, and state without an instance are all cleaned up.
    async reconcile(): Promise<void> {
      const states = new Map<string, StateFile>();
      for (const file of await readdir(stateDir).catch(() => [])) {
        const state = await readFile(join(stateDir, file), "utf-8").then((text) => JSON.parse(text) as StateFile, () => null);
        if (state && BOX_ID.test(state.id) && file === `${state.id}.json`) states.set(state.id, state);
        else await rm(join(stateDir, file), { force: true });
      }

      let adopted = 0;
      let deleted = 0;
      for (const instance of await backend.list()) {
        const state = states.get(instance.id);
        states.delete(instance.id);
        if (state && instance.status === "running") {
          boxes.set(instance.id, {
            id: instance.id,
            state: "ready",
            createdAt: Date.parse(state.createdAt),
            lastActiveAt: now(),
            ttlSeconds: state.ttlSeconds,
            workspaceDir: state.workspaceDir,
            inflightExecs: 0,
          });
          adopted += 1;
        } else {
          await backend.destroy(instance.id);
          if (state) await rm(statePath(instance.id), { force: true });
          deleted += 1;
        }
      }
      for (const id of states.keys()) await rm(statePath(id), { force: true });
      await log("reconcile", { adopted, deleted, staleState: states.size });
    },
  };
}

export type BoxRegistry = ReturnType<typeof createBoxRegistry>;
