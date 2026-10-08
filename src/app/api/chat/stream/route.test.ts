import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "@/core/models/openrouter";
import {
  failingModel,
  finishPart,
  hangingModel,
  streamingModel,
  textParts,
} from "@/core/testing/mock-model";
import { POST } from "./route";
import { withTempRequestLog, waitForLogEntries } from "@/core/testing/request-log";

vi.mock("@/core/models/openrouter", () => ({ createOpenRouterModel: vi.fn() }));

const log = withTempRequestLog();

const conversation = {
  messages: [
    { role: "user", content: "My name is Filip." },
    { role: "assistant", content: "Nice to meet you, Filip." },
    { role: "user", content: "What is my name?" },
  ],
};

function streamRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

function stubOpenRouterModel(model: LanguageModel) {
  vi.mocked(createOpenRouterModel).mockReturnValue(model);
}

async function readFrames(response: Response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("SPEKTER_MODEL", "openai/gpt-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(createOpenRouterModel).mockReset();
});

describe("POST /api/chat/stream", () => {
  it("streams the reply as NDJSON delta frames ending in done with the configured model", async () => {
    stubOpenRouterModel(streamingModel([...textParts(["Your name ", "is Filip."]), finishPart()], "openai/gpt-test"));

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(await readFrames(response)).toEqual([
      { type: "delta", text: "Your name " },
      { type: "delta", text: "is Filip." },
      { type: "done", model: "openai/gpt-test" },
    ]);
    expect(createOpenRouterModel).toHaveBeenCalledWith({ apiKey: "sk-test", model: "openai/gpt-test" });
  });

  it("returns the 503 not_configured JSON error without calling the model when the API key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("not_configured");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty conversation", { messages: [] }],
    ["a conversation ending with an assistant message", { messages: [{ role: "assistant", content: "Hello" }] }],
    ["a body that is not JSON", "not json"],
  ])("returns 400 invalid_request without calling the model for %s", async (_label, body) => {
    const response = await POST(streamRequest(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("keeps status 200 and ends with an error frame when the provider fails mid-stream", async () => {
    stubOpenRouterModel(
      streamingModel([...textParts(["Your name "]), { type: "error", error: new Error("upstream exploded") }]),
    );

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(200);
    expect(await readFrames(response)).toEqual([
      { type: "delta", text: "Your name " },
      { type: "error", code: "provider_error", message: "upstream exploded" },
    ]);
  });

  it("reports a provider failure before any text as an error frame", async () => {
    stubOpenRouterModel(failingModel("Rate limit exceeded"));

    expect(await readFrames(await POST(streamRequest(conversation)))).toEqual([
      { type: "error", code: "provider_error", message: "Rate limit exceeded" },
    ]);
  });

  it("cancels the model call and ends the stream without done or error when the client disconnects", async () => {
    const model = hangingModel(textParts(["Your name "]).slice(0, 2));
    stubOpenRouterModel(model);
    const controller = new AbortController();

    const response = await POST(streamRequest(conversation, controller.signal));
    const reader = response.body!.getReader();
    const first = await reader.read();
    controller.abort();
    const rest = await reader.read();

    expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({ type: "delta", text: "Your name " });
    expect(rest.done).toBe(true);
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  });

  it("returns 500 internal_error for unexpected failures before the stream starts", async () => {
    vi.mocked(createOpenRouterModel).mockImplementation(() => {
      throw new Error("boom");
    });

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal_error", message: "Unexpected server error" } });
  });
});

describe("POST /api/chat/stream request log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function onlyEntry() {
    const [entry] = await waitForLogEntries(log.path);
    return entry;
  }

  it("records one reply entry for a completed stream", async () => {
    stubOpenRouterModel(streamingModel([...textParts(["Your name ", "is Filip."]), finishPart()], "openai/gpt-test"));

    await readFrames(await POST(streamRequest(conversation)));

    expect(await onlyEntry()).toMatchObject({ endpoint: "chat_stream", model: "openai/gpt-test", outcome: "reply" });
  });

  it("records provider_error when the provider fails mid-stream", async () => {
    stubOpenRouterModel(
      streamingModel([...textParts(["Your name "]), { type: "error", error: new Error("upstream exploded") }]),
    );

    await readFrames(await POST(streamRequest(conversation)));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "provider_error" });
  });

  it("records aborted when the client disconnects mid-stream", async () => {
    stubOpenRouterModel(hangingModel(textParts(["Your name "]).slice(0, 2)));
    const controller = new AbortController();

    const response = await POST(streamRequest(conversation, controller.signal));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.read();

    expect(await onlyEntry()).toMatchObject({ outcome: "aborted" });
  });

  it("records not_configured with a null model when SPEKTER_MODEL is unset", async () => {
    vi.stubEnv("SPEKTER_MODEL", "");

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(503);
    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "not_configured", model: null });
  });

  it("records invalid_request for a body that is not JSON", async () => {
    await POST(streamRequest("not json"));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "invalid_request" });
  });
});
