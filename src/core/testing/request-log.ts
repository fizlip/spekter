import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { RequestLogEntry } from "../instrumentation/request-log";

// Points SPEKTER_REQUEST_LOG at a fresh temp file per test so no test writes into the repo.
export function useTempRequestLog() {
  let dir = "";
  const log = { path: "", dir: "" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "spekter-request-log-"));
    log.dir = dir;
    log.path = join(dir, "requests.jsonl");
    vi.stubEnv("SPEKTER_REQUEST_LOG", log.path);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
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

// Log writes are not awaited by the request, so wait until the expected number of entries lands.
export function waitForLogEntries(path: string, count = 1): Promise<RequestLogEntry[]> {
  return vi.waitFor(async () => {
    const entries = await readLogEntries(path);
    expect(entries).toHaveLength(count);
    return entries;
  });
}
