import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveScopedPath } from "./scoped-path";
import type { SpekterTool } from "./types";

const inputSchema = z.object({
  path: z.string().min(1).describe("Path of the file to read, e.g. 'skills/sales-prep/SKILL.md'"),
});

export const readFileTool: SpekterTool<typeof inputSchema, { path: string; content: string }> = {
  name: "read_file",
  description: "Read the contents of a file. Only files inside the allowed folders can be read.",
  inputSchema,
  execute: async ({ path }) => {
    const file = resolveScopedPath(path);
    try {
      return { path, content: await readFile(file, "utf-8") };
    } catch {
      throw new Error(`Cannot read file: ${path}`);
    }
  },
};
