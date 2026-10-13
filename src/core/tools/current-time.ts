import { z } from "zod";
import type { SpekterTool } from "./types";

const inputSchema = z.object({});

export const currentTime: SpekterTool<typeof inputSchema, { now: string; timeZone: string }> = {
  name: "current_time",
  description: "Get the current date and time on the server, as an ISO 8601 timestamp plus the server's timezone.",
  inputSchema,
  execute: async () => ({
    now: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
};
