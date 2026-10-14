import { rm, stat } from "node:fs/promises";
import { z } from "zod";
import { resolveScopedPath } from "./scoped-path";
import type { SpekterTool } from "./types";

const inputSchema = z.object({
  path: z.string().min(1).describe("Path of the file to delete"),
});

export const deleteFileTool: SpekterTool<typeof inputSchema, { path: string; deleted: true }> = {
  name: "delete_file",
  description: "Delete a file. Only files inside the allowed folders can be deleted; folders are refused.",
  inputSchema,
  execute: async ({ path }) => {
    const file = resolveScopedPath(path);
    const info = await stat(file).catch(() => {
      throw new Error(`Cannot delete file: ${path}`);
    });
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    await rm(file);
    return { path, deleted: true };
  },
};
