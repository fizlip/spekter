import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { fileToolDirs, resolveScopedPath } from "./scoped-path";
import type { SpekterTool } from "./types";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Folder to list, e.g. 'skills'. Omit to list every allowed folder."),
});

// Hidden files stay invisible, matching the knowledge folder's convention.
async function walk(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full, base);
        if (entry.isFile()) return [relative(base, full)];
        return [];
      }),
  );
  return files.flat();
}

export const listFilesTool: SpekterTool<typeof inputSchema, { files: string[] }> = {
  name: "list_files",
  description:
    "List files, recursively. With no path it lists every allowed folder; a path must point inside an allowed folder.",
  inputSchema,
  execute: async ({ path }) => {
    // Validate the folder, but walk the path as given so listed paths stay relative to the
    // project; the walk itself never follows links.
    if (path) await resolveScopedPath(path);
    const roots = path ? [resolve(path)] : fileToolDirs().map((dir) => resolve(dir));
    const base = resolve();
    const files = (await Promise.all(roots.map((dir) => walk(dir, base)))).flat().sort();
    return { files };
  },
};
