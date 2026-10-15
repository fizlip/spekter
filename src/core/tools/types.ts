import type { z } from "zod";

// A tool in Spekter's own shape, so tool Bricks never depend on whichever agent loop runs them.
export type SpekterTool<Schema extends z.ZodType = z.ZodType, Output = unknown> = {
  name: string;
  description: string;
  inputSchema: Schema;
  execute: (input: z.infer<Schema>, options: { abortSignal?: AbortSignal }) => Promise<Output>;
};
