import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type EventLog = (event: string, fields?: Record<string, unknown>) => Promise<void>;

// One JSON line per lifecycle event. Never rejects: a failed write must not change or delay a box operation.
export function createEventLog(path: string): EventLog {
  return async (event, fields = {}) => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`);
    } catch (error) {
      console.error(`Failed to write sandboxd event to ${path}`, error);
    }
  };
}
