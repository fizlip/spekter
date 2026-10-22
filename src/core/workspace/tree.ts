import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BoxInfo, BoxState } from "@/sandbox/boxes";
import { readWorkspaceRoot } from "@/sandbox/config";
import { sandboxClient } from "../tools/sandbox-exec";
import type { Env } from "../config";

export type WorkspaceNode = {
  name: string;
  kind: "dir" | "file";
  // Set when mtime is within RECENT_MS — the "what the agent is doing" signal. On a dir it
  // means the dir itself or something inside it changed, so collapsed parents still show it.
  recent?: true;
  // Set on dirs whose contents are deliberately not listed (node_modules).
  unlisted?: true;
  children?: WorkspaceNode[];
};

export type WorkspaceTree = {
  id: string;
  live: boolean;
  state?: BoxState;
  nodes: WorkspaceNode[];
  truncated?: true;
};

// daemon reports why the live/dead distinction may be missing: the tree comes from disk either way.
export type WorkspaceTrees = {
  workspaces: WorkspaceTree[];
  daemon: "ok" | "unreachable" | "unconfigured";
};

// A guest's node_modules can hold far more files than a sidebar will ever show.
export const MAX_TREE_NODES = 500;
export const RECENT_MS = 30_000;
const SKIPPED_DIRS = new Set(["node_modules"]);

async function listLiveBoxes(env: Env): Promise<{ boxes: BoxInfo[]; daemon: WorkspaceTrees["daemon"] }> {
  if (!env.SANDBOX_TOKEN?.trim()) return { boxes: [], daemon: "unconfigured" };
  try {
    const { boxes } = await sandboxClient(env).list();
    return { boxes, daemon: "ok" };
  } catch {
    return { boxes: [], daemon: "unreachable" };
  }
}

// Depth-first over the host dir, dirs first then alphabetical, dotfiles skipped — matching the
// list_files tool. Symlinks show as leaves but are never followed into. The budget is shared
// across the whole workspace so a deep tree sets truncated instead of ballooning.
async function scan(dir: string, now: number, budget: { left: number }): Promise<{ nodes: WorkspaceNode[]; truncated: boolean }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const nodes: WorkspaceNode[] = [];
  let truncated = false;

  const visible = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  for (const entry of visible) {
    const isDir = entry.isDirectory();
    if (!isDir && !entry.isFile() && !entry.isSymbolicLink()) continue;
    if (budget.left <= 0) {
      truncated = true;
      break;
    }
    budget.left -= 1;

    const mtime = await stat(join(dir, entry.name)).then((s) => s.mtimeMs, () => null);
    const recent = mtime !== null && now - mtime <= RECENT_MS ? (true as const) : undefined;

    if (isDir && !SKIPPED_DIRS.has(entry.name)) {
      const child = await scan(join(dir, entry.name), now, budget);
      nodes.push({
        name: entry.name,
        kind: "dir",
        ...(recent || child.nodes.some((node) => node.recent) ? { recent: true as const } : {}),
        children: child.nodes,
      });
      truncated = truncated || child.truncated;
    } else {
      nodes.push({
        name: entry.name,
        kind: isDir ? "dir" : "file",
        ...(isDir ? { unlisted: true as const } : {}),
        ...(recent ? { recent } : {}),
      });
    }
  }
  return { nodes, truncated };
}

// Live boxes come from sandboxd; every other directory under the workspace root is a workspace
// kept after its box was destroyed, listed as archived.
export async function readWorkspaceTrees(env: Env = process.env, now = Date.now()): Promise<WorkspaceTrees> {
  const root = readWorkspaceRoot(env);
  const { boxes, daemon } = await listLiveBoxes(env);
  const live = new Map(boxes.map((box) => [box.id, box]));

  const names = new Set(live.keys());
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) names.add(entry.name);
  }

  const workspaces = await Promise.all(
    [...names].sort().map(async (name) => {
      const { nodes, truncated } = await scan(join(root, name), now, { left: MAX_TREE_NODES });
      const box = live.get(name);
      return {
        id: name,
        live: box !== undefined,
        ...(box ? { state: box.state } : {}),
        nodes,
        ...(truncated ? { truncated: true as const } : {}),
      };
    }),
  );
  return { workspaces, daemon };
}
