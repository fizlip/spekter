import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamFrame } from "../chat/stream-frames";
import { InvalidRequestError, NotConfiguredError, ProviderError } from "../errors";
import { readLogEntries, waitForLogEntries, withTempRequestLog } from "../testing/request-log";
import { trackRequest, trackStream } from "./request-log";

const log = withTempRequestLog();
const readEntries = (path = log.path) => readLogEntries(path);
const waitForEntries = () => waitForLogEntries(log.path);

beforeEach(() => {
  vi.stubEnv("SPEKTER_MODEL", "openai/gpt-test");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("trackRequest", () => {
  it("writes one reply entry with timestamp, endpoint, model and duration", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00.000Z"), toFake: ["Date", "performance"] });
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
    const nested = join(log.dir, "a", "b", "requests.jsonl");
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
    const blocker = join(log.dir, "not-a-dir");
    await writeFile(blocker, "");
    vi.stubEnv("SPEKTER_REQUEST_LOG", join(blocker, "requests.jsonl"));

    await expect(trackRequest("chat").reply()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("trackStream", () => {
  async function* framesOf(frames: ChatStreamFrame[], end?: Error): AsyncGenerator<ChatStreamFrame> {
    yield* frames;
    if (end) throw end;
  }

  async function drain(frames: AsyncGenerator<ChatStreamFrame>) {
    const out: ChatStreamFrame[] = [];
    for await (const frame of frames) out.push(frame);
    return out;
  }

  it("passes frames through unchanged and records a reply on done", async () => {
    const frames: ChatStreamFrame[] = [
      { type: "delta", text: "Hi " },
      { type: "delta", text: "Filip" },
      { type: "done", model: "openai/gpt-test" },
    ];

    expect(await drain(trackStream(trackRequest("chat_stream"), framesOf(frames)))).toEqual(frames);
    expect((await waitForEntries())[0]).toMatchObject({ endpoint: "chat_stream", outcome: "reply" });
  });

  it("records an error frame as an error with the frame's code", async () => {
    const frames: ChatStreamFrame[] = [
      { type: "delta", text: "Hi " },
      { type: "error", code: "provider_error", message: "upstream exploded" },
    ];

    expect(await drain(trackStream(trackRequest("chat_stream"), framesOf(frames)))).toEqual(frames);
    expect((await waitForEntries())[0]).toMatchObject({ outcome: "error", errorCode: "provider_error" });
  });

  it("does not settle on reasoning frames", async () => {
    const frames: ChatStreamFrame[] = [
      { type: "reasoning", text: "thinking" },
      { type: "done", model: "openai/gpt-test" },
    ];

    await drain(trackStream(trackRequest("chat_stream"), framesOf(frames)));
    expect((await waitForEntries())[0]).toMatchObject({ outcome: "reply" });
  });

  it("records aborted when the consumer cancels mid-stream", async () => {
    const wrapped = trackStream(trackRequest("chat_stream"), framesOf([{ type: "delta", text: "Hi " }, { type: "delta", text: "more" }]));

    await wrapped.next();
    await wrapped.return(undefined);

    expect((await waitForEntries())[0]).toMatchObject({ outcome: "aborted" });
    expect((await readEntries())[0]).not.toHaveProperty("errorCode");
  });

  it("records aborted when the stream ends without a terminal frame", async () => {
    await drain(trackStream(trackRequest("chat_stream"), framesOf([{ type: "delta", text: "Hi " }])));

    expect((await waitForEntries())[0]).toMatchObject({ outcome: "aborted" });
  });

  it("records internal_error and rethrows when the inner stream throws", async () => {
    const wrapped = trackStream(trackRequest("chat_stream"), framesOf([], new Error("boom")));

    await expect(drain(wrapped)).rejects.toThrow("boom");
    expect((await waitForEntries())[0]).toMatchObject({ outcome: "error", errorCode: "internal_error" });
  });
});
