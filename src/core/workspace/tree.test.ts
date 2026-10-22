import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TREE_NODES, readWorkspaceTrees, RECENT_MS } from "./tree";

let root: string;

const NOW = Date.parse("2026-10-21T12:00:00Z");

async function touch(path: string, ageMs: number) {
  const time = new Date(NOW - ageMs);
  await utimes(path, time, time);
}

beforeEach(async () => {
  root = join(tmpdir(), `spekter-tree-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  vi.stubEnv("SANDBOX_WORKSPACE_ROOT", root);
  // No token: the daemon is never queried and workspaces all come back as kept-on-disk.
  vi.stubEnv("SANDBOX_TOKEN", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("readWorkspaceTrees", () => {
  it("lists directories under the workspace root as archived workspaces", async () => {
    await mkdir(join(root, "b1", "src"), { recursive: true });
    await writeFile(join(root, "b1", "src", "main.py"), "");
    await writeFile(join(root, "b1", "README.md"), "");
    // Age everything so the structural assertions aren't tangled up in the recent flag.
    await touch(join(root, "b1", "src", "main.py"), RECENT_MS * 4);
    await touch(join(root, "b1", "src"), RECENT_MS * 4);
    await touch(join(root, "b1", "README.md"), RECENT_MS * 4);
    await mkdir(join(root, "b2"));

    const { workspaces, daemon } = await readWorkspaceTrees(process.env, NOW);

    expect(daemon).toBe("unconfigured");
    expect(workspaces).toEqual([
      {
        id: "b1",
        live: false,
        nodes: [
          {
            name: "src",
            kind: "dir",
            children: [{ name: "main.py", kind: "file" }],
          },
          { name: "README.md", kind: "file" },
        ],
      },
      { id: "b2", live: false, nodes: [] },
    ]);
  });

  it("skips hidden entries and lists node_modules as unlisted", async () => {
    await mkdir(join(root, "b1", ".git", "objects"), { recursive: true });
    await mkdir(join(root, "b1", "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "b1", ".env"), "secret");
    await writeFile(join(root, "b1", "node_modules", "pkg", "index.js"), "");
    await touch(join(root, "b1", "node_modules"), RECENT_MS * 4);

    const { workspaces } = await readWorkspaceTrees(process.env, NOW);

    expect(workspaces[0].nodes).toEqual([{ name: "node_modules", kind: "dir", unlisted: true }]);
  });

  it("flags files modified within RECENT_MS and propagates the flag up to parent dirs", async () => {
    await mkdir(join(root, "b1", "deep", "deeper"), { recursive: true });
    const fresh = join(root, "b1", "deep", "deeper", "fresh.txt");
    await writeFile(fresh, "");
    await touch(fresh, RECENT_MS / 2);
    const stale = join(root, "b1", "old.txt");
    await writeFile(stale, "");
    await touch(stale, RECENT_MS * 4);

    const { workspaces } = await readWorkspaceTrees(process.env, NOW);

    const deep = workspaces[0].nodes.find((node) => node.name === "deep");
    expect(deep?.recent).toBe(true);
    expect(deep?.children?.[0].recent).toBe(true);
    expect(deep?.children?.[0].children?.[0]).toMatchObject({ name: "fresh.txt", recent: true });
    expect(workspaces[0].nodes.find((node) => node.name === "old.txt")?.recent).toBeUndefined();
  });

  it("marks workspaces live when the daemon lists a matching box", async () => {
    await mkdir(join(root, "b1"));
    await mkdir(join(root, "gone"));
    vi.stubEnv("SANDBOX_TOKEN", "x".repeat(32));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ boxes: [{ id: "b1", state: "ready" }] }),
      })),
    );

    const { workspaces, daemon } = await readWorkspaceTrees(process.env, NOW);

    expect(daemon).toBe("ok");
    expect(workspaces).toEqual([
      expect.objectContaining({ id: "b1", live: true, state: "ready" }),
      expect.objectContaining({ id: "gone", live: false }),
    ]);
  });

  it("still lists workspaces from disk when the daemon is unreachable", async () => {
    await mkdir(join(root, "b1"));
    vi.stubEnv("SANDBOX_TOKEN", "x".repeat(32));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));

    const { workspaces, daemon } = await readWorkspaceTrees(process.env, NOW);

    expect(daemon).toBe("unreachable");
    expect(workspaces).toEqual([expect.objectContaining({ id: "b1", live: false })]);
  });

  it("includes live boxes that have no directory on disk yet", async () => {
    vi.stubEnv("SANDBOX_TOKEN", "x".repeat(32));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ boxes: [{ id: "b9", state: "creating" }] }) })),
    );

    const { workspaces } = await readWorkspaceTrees(process.env, NOW);

    expect(workspaces).toEqual([expect.objectContaining({ id: "b9", live: true, state: "creating", nodes: [] })]);
  });

  it("truncates a workspace with more than MAX_TREE_NODES entries", async () => {
    await mkdir(join(root, "b1"));
    await Promise.all(
      Array.from({ length: MAX_TREE_NODES + 1 }, (_, i) => writeFile(join(root, "b1", `f${String(i).padStart(4, "0")}.txt`), "")),
    );

    const { workspaces } = await readWorkspaceTrees(process.env, NOW);

    expect(workspaces[0].nodes).toHaveLength(MAX_TREE_NODES);
    expect(workspaces[0].truncated).toBe(true);
  });
});
