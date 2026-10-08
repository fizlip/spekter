import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readConfiguredModel } from "../config";
import { SpekterError, type ErrorCode } from "../errors";

const DEFAULT_LOG_PATH = "logs/requests.jsonl";

export type RequestEndpoint = "chat" | "chat_stream";

export type RequestLogEntry = {
  timestamp: string;
  endpoint: RequestEndpoint;
  model: string | null;
  outcome: "reply" | "error" | "aborted";
  errorCode?: ErrorCode | "internal_error";
  durationMs: number;
};

export type RequestTracker = {
  reply(): Promise<void>;
  fail(error: unknown): Promise<void>;
  abort(): Promise<void>;
};

// One tracker per request; only the first settle writes, so each request logs exactly one entry.
export function trackRequest(endpoint: RequestEndpoint): RequestTracker {
  const startedAt = Date.now();
  const model = readConfiguredModel();
  let settled = false;

  const settle = (outcome: RequestLogEntry["outcome"], errorCode?: RequestLogEntry["errorCode"]) => {
    if (settled) return Promise.resolve();
    settled = true;
    return writeEntry({
      timestamp: new Date(startedAt).toISOString(),
      endpoint,
      model,
      outcome,
      ...(errorCode && { errorCode }),
      durationMs: Date.now() - startedAt,
    });
  };

  return {
    reply: () => settle("reply"),
    fail: (error) => settle("error", error instanceof SpekterError ? error.code : "internal_error"),
    abort: () => settle("aborted"),
  };
}

// Never rejects: a failed write must not change or delay the caller's reply.
async function writeEntry(entry: RequestLogEntry): Promise<void> {
  const path = resolve(process.env.SPEKTER_REQUEST_LOG?.trim() || DEFAULT_LOG_PATH);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error(`Failed to write request log entry to ${path}`, error);
  }
}
