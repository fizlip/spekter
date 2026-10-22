import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBackend } from "./backend/fake";
import { createBoxRegistry } from "./boxes";
import { SandboxError } from "./wire";

let dir: string;
let fake: ReturnType<typeof createFakeBackend>;
let clock: number;
const events: { event: string; fields?: Record<string, unknown> }[] = [];

function registry(overrides: { maxBoxes?: number } = {}) {
  return createBoxRegistry({
    backend: fake.backend,
    stateDir: join(dir, "boxes"),
    workspaceRoot: join(dir, "workspace"),
    maxBoxes: overrides.maxBoxes ?? 4,
    defaultTtlSeconds: 60,
    log: async (event, fields) => {
      events.push({ event, fields });
    },
    now: () => clock,
  });
}

const exists = (path: string) => access(path).then(() => true, () => false);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sandboxd-boxes-"));
  fake = createFakeBackend();
  clock = Date.parse("2026-10-19T10:00:00.000Z");
  events.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("box lifecycle", () => {
  it("creates a box, persisting its state before the backend boots it", async () => {
    const boxes = registry();
    fake.hooks.create = async (id) => {
      expect(await exists(join(dir, "boxes", `${id}.json`))).toBe(true);
    };

    const box = await boxes.create({});

    expect(box).toMatchObject({ state: "ready", ttlSeconds: 60, inflightExecs: 0 });
    expect(box.id).toMatch(/^[a-z0-9][a-z0-9-]{0,19}$/);
    expect(box.workspaceDir).toBe(join(dir, "workspace", box.id));
    expect(await exists(box.workspaceDir)).toBe(true);
    expect(fake.instances.get(box.id)).toBe("running");
    expect(events.map((entry) => entry.event)).toEqual(["box.create", "box.ready"]);
  });

  it("uses a caller-supplied name as the id and honors a per-box TTL", async () => {
    const box = await registry().create({ name: "build-1", ttlSeconds: 5 });

    expect(box).toMatchObject({ id: "build-1", ttlSeconds: 5 });
  });

  it("lists and inspects live boxes", async () => {
    const boxes = registry();
    const a = await boxes.create({ name: "a" });
    await boxes.create({ name: "b" });

    expect(boxes.list().map((box) => box.id)).toEqual(["a", "b"]);
    expect(boxes.get("a")).toEqual(a);
  });

  it("destroys the guest and its state but keeps the workspace on the host", async () => {
    const boxes = registry();
    const box = await boxes.create({ name: "a" });
    await writeFile(join(box.workspaceDir, "artifact.txt"), "keep me");

    await boxes.destroy("a");

    expect(fake.instances.has("a")).toBe(false);
    expect(await exists(join(dir, "boxes", "a.json"))).toBe(false);
    expect(await readFile(join(box.workspaceDir, "artifact.txt"), "utf-8")).toBe("keep me");
    expect(boxes.list()).toEqual([]);
    expect(events.at(-1)).toMatchObject({ event: "box.destroy", fields: { boxId: "a", reason: "destroyed" } });
  });

  it("names the live boxes when an id is unknown, so a caller can recover", async () => {
    const boxes = registry();
    await boxes.create({ name: "a" });
    await boxes.create({ name: "b" });

    expect(() => boxes.get("gone")).toThrow(new SandboxError("not_found", 'No box "gone". Live boxes: a, b'));
    await expect(boxes.destroy("gone")).rejects.toThrow('No box "gone". Live boxes: a, b');
  });

  it("says when there are no live boxes at all", () => {
    expect(() => registry().get("gone")).toThrow(new SandboxError("not_found", 'No box "gone". There are no live boxes.'));
  });

  it("rejects a name already in use", async () => {
    const boxes = registry();
    await boxes.create({ name: "a" });

    await expect(boxes.create({ name: "a" })).rejects.toThrow(new SandboxError("conflict", 'A box named "a" already exists'));
  });

  it.each(["../escape", "a/b", "Upper", "-lead", "a".repeat(21), ""])("rejects the unsafe name %j before touching any path", async (name) => {
    await expect(registry().create({ name })).rejects.toMatchObject({ code: "invalid_request" });
    expect(fake.calls).toEqual([]);
  });

  it("rejects creates beyond the concurrent-box cap, naming the live boxes so a caller can reuse or destroy one", async () => {
    const boxes = registry({ maxBoxes: 2 });
    await boxes.create({ name: "a" });
    await boxes.create({ name: "b" });

    await expect(boxes.create({})).rejects.toThrow(
      new SandboxError("conflict", "Box limit reached (2 live boxes: a, b). Reuse one of them, or destroy one first"),
    );
  });

  it("cleans up a box whose backend failed to start it", async () => {
    const boxes = registry();
    fake.hooks.create = async () => {
      throw new Error("vz refused to boot");
    };

    await expect(boxes.create({ name: "a" })).rejects.toThrow(
      new SandboxError("internal_error", 'Box "a" failed to start: vz refused to boot'),
    );
    expect(boxes.list()).toEqual([]);
    expect(fake.calls).toEqual(["create a", "destroy a"]);
    expect(await exists(join(dir, "boxes", "a.json"))).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: "box.failed", fields: { boxId: "a" } });
  });
});

describe("idle reaping", () => {
  it("reaps a box idle past its TTL and keeps its workspace", async () => {
    const boxes = registry();
    const box = await boxes.create({ name: "a" });
    clock += 61_000;

    await boxes.reap();

    expect(boxes.list()).toEqual([]);
    expect(fake.instances.has("a")).toBe(false);
    expect(await exists(box.workspaceDir)).toBe(true);
    expect(events.at(-1)).toMatchObject({ event: "box.destroy", fields: { boxId: "a", reason: "ttl", idleMs: 61_000 } });
  });

  it("keeps a box that is not idle long enough, honoring its own TTL", async () => {
    const boxes = registry();
    await boxes.create({ name: "short", ttlSeconds: 10 });
    await boxes.create({ name: "default" });
    clock += 30_000;

    await boxes.reap();

    expect(boxes.list().map((box) => box.id)).toEqual(["default"]);
  });

  it("never reaps a box while a command is running in it", async () => {
    const boxes = registry();
    await boxes.create({ name: "a" });
    let finish!: () => void;
    const exec = boxes.runExec("a", () => new Promise<void>((resolve) => (finish = resolve)));
    clock += 600_000;

    await boxes.reap();
    expect(boxes.get("a").inflightExecs).toBe(1);

    finish();
    await exec;
    expect(boxes.get("a")).toMatchObject({ inflightExecs: 0, lastActiveAt: new Date(clock).toISOString() });
  });

  it("lets an exec that arrives mid-sweep win the re-check under the lock", async () => {
    const boxes = registry();
    await boxes.create({ name: "a" });
    clock += 61_000;

    const sweep = boxes.reap();
    const exec = boxes.runExec("a", async () => "ran");
    await sweep;

    expect(boxes.list().map((box) => box.id)).toEqual(["a"]);
    await expect(exec).resolves.toBe("ran");
  });

  it("sweeps on a timer once started", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const boxes = registry();
    await boxes.create({ name: "a" });
    clock += 61_000;

    const stop = boxes.startReaper(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    stop();

    expect(boxes.list()).toEqual([]);
  });
});

describe("startup reconciliation", () => {
  async function seedState(id: string) {
    await mkdir(join(dir, "boxes"), { recursive: true });
    await writeFile(
      join(dir, "boxes", `${id}.json`),
      JSON.stringify({ id, ttlSeconds: 120, createdAt: "2026-10-19T09:00:00.000Z", workspaceDir: join(dir, "workspace", id) }),
    );
  }

  it("adopts boxes left running by a previous daemon, with a fresh idle clock", async () => {
    await seedState("kept");
    fake.instances.set("kept", "running");

    const boxes = registry();
    await boxes.reconcile();

    expect(boxes.get("kept")).toMatchObject({ state: "ready", ttlSeconds: 120, lastActiveAt: new Date(clock).toISOString() });
  });

  it("force-deletes instances with no state file and sweeps broken ones", async () => {
    fake.instances.set("orphan", "running");
    await seedState("dead");
    fake.instances.set("dead", "broken");
    await seedState("vanished");

    const boxes = registry();
    await boxes.reconcile();

    expect(boxes.list()).toEqual([]);
    expect(fake.instances.size).toBe(0);
    expect(await readdir(join(dir, "boxes"))).toEqual([]);
    expect(events.at(-1)).toEqual({ event: "reconcile", fields: { adopted: 0, deleted: 2, staleState: 1 } });
  });
});
