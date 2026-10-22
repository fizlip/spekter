import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveScopedPath, statIfExists } from "./scoped-path";
import type { SpekterTool } from "./types";

const inputSchema = z.object({
  path: z.string().min(1).describe("Path of the file to edit"),
  old_string: z
    .string()
    .min(1)
    .describe("Exact text to replace; must appear exactly once in the file"),
  new_string: z.string().describe("Text that replaces old_string"),
});

// Patch-style edit: the model must quote the text it is changing, so a stale or
// ambiguous edit fails instead of rewriting the file blind.
export const editFileTool: SpekterTool<typeof inputSchema, { path: string }> = {
  name: "edit_file",
  description:
    "Replace a piece of an existing file. old_string must match exactly once — include enough surrounding text to make it unique.",
  inputSchema,
  execute: async ({ path, old_string, new_string }) => {
    const file = await resolveScopedPath(path);
    const info = await statIfExists(file);
    if (info && !info.isFile()) throw new Error(`Not a file: ${path}`);
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      throw new Error(`Cannot read file: ${path}`);
    }
    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) throw new Error(`old_string not found in ${path}`);
    if (occurrences > 1) throw new Error(`old_string appears ${occurrences} times in ${path}; make it unique`);
    await writeFile(file, content.replace(old_string, new_string), "utf-8");
    return { path };
  },
};
