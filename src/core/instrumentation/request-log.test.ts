import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidRequestError, NotConfiguredError, ProviderError } from "../errors";
import { trackRequest, type RequestLogEntry } from "./request-log";

let dir: string;
let logPath: string;

async function readEntries(path = logPath): Promise<RequestLogEntry[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-request-log-"));
  logPath = join(dir, "requests.jsonl");
  vi.stubEnv("SPEKTER_REQUEST_LOG", logPath);
  vi.stubEnv("SPEKTER_MODEL", "openai/gpt-test");
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("trackRequest", () => {
  it("writes one reply entry with timestamp, endpoint, model and duration", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00.000Z") });
    const tracker = trackRequest("chat");
    vi.advanceTimersByTime(1234);
    await tracker.reply();

    expect(await readEntries()).toEqual([
      {
        timestamp: "2026-10-08T10:00:00.000Z",
        endpoint: "chat",
        model: "openai/gpt-test",
        outcome: "reply",
        durationMs: 1234,
      },
    ]);
  });

  it.each([
    ["InvalidRequestError", new InvalidRequestError("bad"), "invalid_request"],
    ["NotConfiguredError", new NotConfiguredError("missing"), "not_configured"],
    ["ProviderError", new ProviderError("upstream"), "provider_error"],
    ["a plain Error", new Error("boom"), "internal_error"],
  ])("records %s as an error with its code", async (_label, error, errorCode) => {
    await trackRequest("chat").fail(error);

    const [entry] = await readEntries();
    expect(entry).toMatchObject({ outcome: "error", errorCode });
  });

  it("writes only the first settle", async () => {
    const tracker = trackRequest("chat");
    await tracker.reply();
    await tracker.fail(new ProviderError("late"));

    expect(await readEntries()).toHaveLength(1);
    expect((await readEntries())[0]).toMatchObject({ outcome: "reply" });
  });

  it.each([["unset", undefined], ["blank", "   "]])("records a null model when SPEKTER_MODEL is %s", async (_label, value) => {
    vi.stubEnv("SPEKTER_MODEL", value);
    await trackRequest("chat").reply();

    expect((await readEntries())[0].model).toBeNull();
  });

  it("creates missing parent directories for the log file", async () => {
    const nested = join(dir, "a", "b", "requests.jsonl");
    vi.stubEnv("SPEKTER_REQUEST_LOG", nested);
    await trackRequest("chat").reply();

    expect(await readEntries(nested)).toHaveLength(1);
  });

  it("appends separate, parseable lines for concurrent requests", async () => {
    await Promise.all([trackRequest("chat").reply(), trackRequest("chat_stream").fail(new Error("x"))]);

    const entries = await readEntries();
    expect(entries.map((entry) => entry.endpoint).sort()).toEqual(["chat", "chat_stream"]);
  });

  it("reports a failed write to the console without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "");
    vi.stubEnv("SPEKTER_REQUEST_LOG", join(blocker, "requests.jsonl"));

    await expect(trackRequest("chat").reply()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
