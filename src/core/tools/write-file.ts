import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveScopedPath, statIfExists } from "./scoped-path";
import type { SpekterTool } from "./types";

const inputSchema = z.object({
  path: z.string().min(1).describe("Path of the file to write, e.g. 'skills/sales-prep/SKILL.md'"),
  content: z.string().describe("Full content the file should have after writing"),
});

// Creates missing parent folders so new paths like skills/<name>/SKILL.md work.
export const writeFileTool: SpekterTool<typeof inputSchema, { path: string; bytes: number }> = {
  name: "write_file",
  description:
    "Create or fully overwrite a file. Only files inside the allowed folders can be written; parent folders are created as needed.",
  inputSchema,
  execute: async ({ path, content }) => {
    const file = await resolveScopedPath(path);
    const existing = await statIfExists(file);
    if (existing && !existing.isFile()) throw new Error(`Not a file: ${path}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf-8");
    return { path, bytes: Buffer.byteLength(content) };
  },
};
