import { open } from "node:fs/promises";
import { z } from "zod";
import { resolveScopedPath, statIfExists } from "./scoped-path";
import type { SpekterTool } from "./types";

// Bounds what one read can put into the model's context.
export const MAX_READ_BYTES = 100_000;

const inputSchema = z.object({
  path: z.string().min(1).describe("Path of the file to read, e.g. 'skills/sales-prep/SKILL.md'"),
});

export const readFileTool: SpekterTool<typeof inputSchema, { path: string; content: string; truncated?: true }> = {
  name: "read_file",
  description: `Read the contents of a file. Only files inside the allowed folders can be read. Files over ${MAX_READ_BYTES} bytes return only their first ${MAX_READ_BYTES} bytes, with truncated: true.`,
  inputSchema,
  execute: async ({ path }) => {
    const file = await resolveScopedPath(path);
    const info = await statIfExists(file);
    if (!info) throw new Error(`Cannot read file: ${path}`);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    const handle = await open(file, "r").catch(() => {
      throw new Error(`Cannot read file: ${path}`);
    });
    try {
      const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(Math.min(info.size, MAX_READ_BYTES)) });
      const content = buffer.subarray(0, bytesRead).toString("utf-8");
      return info.size > MAX_READ_BYTES ? { path, content, truncated: true } : { path, content };
    } finally {
      await handle.close();
    }
  },
};
