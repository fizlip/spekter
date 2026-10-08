import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { RequestLogEntry } from "../instrumentation/request-log";

// Points SPEKTER_REQUEST_LOG at a fresh temp file per test so no test writes into the repo.
export function withTempRequestLog() {
  const log = { path: "", dir: "" };

  beforeEach(async () => {
    log.dir = await mkdtemp(join(tmpdir(), "spekter-request-log-"));
    log.path = join(log.dir, "requests.jsonl");
    vi.stubEnv("SPEKTER_REQUEST_LOG", log.path);
  });

  // A request's log write is not awaited, so give an in-flight write time to open its file
  // before removing the directory under it. Tests that write nothing just hit the short timeout.
  afterEach(async () => {
    await vi.waitFor(() => access(log.path), { timeout: 100, interval: 5 }).catch(() => {});
    await rm(log.dir, { recursive: true, force: true });
  });

  return log;
}

export async function readLogEntries(path: string): Promise<RequestLogEntry[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Log writes are not awaited by the request, so wait until the single expected entry lands.
export function waitForLogEntries(path: string): Promise<RequestLogEntry[]> {
  return vi.waitFor(async () => {
    const entries = await readLogEntries(path);
    expect(entries).toHaveLength(1);
    return entries;
  });
}
