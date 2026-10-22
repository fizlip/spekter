import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { fileToolRoots, resolveScopedPath, resolveToolPath } from "./scoped-path";
import type { SpekterTool } from "./types";

// A sandbox workspace can hold a guest's node_modules; one listing must not flood the context.
export const MAX_LISTED_FILES = 1000;

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Folder to list, e.g. 'skills'. Omit to list every allowed folder."),
});

// Collects into `files` until it holds one more than the cap (enough to know the listing is
// truncated), then stops reading: a workspace can hold far more files than will ever be shown.
// Hidden files stay invisible, matching the knowledge folder's convention.
async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length > MAX_LISTED_FILES) return;
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

export const listFilesTool: SpekterTool<typeof inputSchema, { files: string[]; truncated?: true }> = {
  name: "list_files",
  description: `List files, recursively. With no path it lists every allowed folder; a path must point inside an allowed folder. Files inside the project are listed relative to it, others (such as sandbox workspaces) by absolute path. At most ${MAX_LISTED_FILES} files are returned, with truncated: true when there were more.`,
  inputSchema,
  execute: async ({ path }) => {
    // Validate the folder, but walk the path as given so listed paths stay relative to the
    // project; the walk itself never follows links.
    if (path) await resolveScopedPath(path);
    const roots = path ? [resolveToolPath(path)] : fileToolRoots();
    const base = resolve();
    const display = (file: string) => (file.startsWith(base + sep) ? relative(base, file) : file);
    // Roots in order (skills, knowledge, then workspaces), so a flooded workspace cannot crowd
    // out the project folders; the cut happens in walk order, before sorting for display.
    const found: string[] = [];
    for (const root of roots) await walk(root, found);
    const files = found.slice(0, MAX_LISTED_FILES).map(display).sort();
    return found.length > MAX_LISTED_FILES ? { files, truncated: true } : { files };
  },
};
