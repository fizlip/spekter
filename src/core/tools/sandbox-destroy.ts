import { z } from "zod";
import { explainSandboxError, sandboxClient, withBudget } from "./sandbox-exec";
import type { SpekterTool } from "./types";

const DESTROY_BUDGET_MS = 60_000;

const inputSchema = z.object({
  box: z.string().min(1).describe("Id of the box to destroy, as returned by sandbox_exec."),
});

export const sandboxDestroyTool: SpekterTool<typeof inputSchema, { box: string; destroyed: true; note: string }> = {
  name: "sandbox_destroy",
  description:
    "Destroy a sandbox box when you are done with it, discarding everything installed in it. Files saved under its /workspace are kept on the host.",
  inputSchema,
  execute: async ({ box }, { abortSignal }) => {
    try {
      await sandboxClient().destroy(box, withBudget(abortSignal, DESTROY_BUDGET_MS));
      return { box, destroyed: true, note: "The box is gone; its workspace folder on the host is kept." };
    } catch (error) {
      explainSandboxError(error);
    }
  },
};
