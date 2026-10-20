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

// Hidden files stay invisible, matching the knowledge folder's convention.
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (entry.isFile()) return [full];
        return [];
      }),
  );
  return files.flat();
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
    const files = (await Promise.all(roots.map(walk))).flat().map(display).sort();
    return files.length > MAX_LISTED_FILES ? { files: files.slice(0, MAX_LISTED_FILES), truncated: true } : { files };
  },
};
