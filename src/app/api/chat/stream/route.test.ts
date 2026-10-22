import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "@/core/models/openrouter";
import {
  failingModel,
  finishPart,
  hangingModel,
  scriptedStreamingModel,
  streamingModel,
  textParts,
  toolCallParts,
} from "@/core/testing/mock-model";
import { waitForLogEntries, withTempRequestLog } from "@/core/testing/request-log";
import { POST } from "./route";

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

let promptDir: string;

beforeEach(async () => {
  promptDir = await mkdtemp(join(tmpdir(), "spekter-system-prompt-route-"));
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("SPEKTER_MODEL", "openai/gpt-test");
});

afterEach(async () => {
  await rm(promptDir, { recursive: true, force: true });
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
      { type: "done", model: "openai/gpt-test", sources: [] },
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

  it("offers the built-in current_time tool to the model", async () => {
    const model = streamingModel([...textParts(["Hi."]), finishPart()]);
    stubOpenRouterModel(model);

    await readFrames(await POST(streamRequest(conversation)));

    expect(model.doStreamCalls[0].tools?.map((tool) => tool.name)).toEqual([
      "current_time",
      "list_files",
      "list_skills",
      "skill_metadata",
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
      "sandbox_exec",
      "sandbox_destroy",
    ]);
  });

  it("returns the 503 not_configured JSON error before the stream starts when SPEKTER_MAX_STEPS is invalid", async () => {
    vi.stubEnv("SPEKTER_MAX_STEPS", "0");

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("SPEKTER_MAX_STEPS");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("streams the configured system prompt to the model without changing the frames", async () => {
    const path = join(promptDir, "prompt.md");
    await writeFile(path, "Answer in exactly one word.");
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", path);
    const model = streamingModel([...textParts(["Your name ", "is Filip."]), finishPart()], "openai/gpt-test");
    stubOpenRouterModel(model);

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(200);
    expect(await readFrames(response)).toEqual([
      { type: "delta", text: "Your name " },
      { type: "delta", text: "is Filip." },
      { type: "done", model: "openai/gpt-test", sources: [] },
    ]);
    expect(model.doStreamCalls[0].prompt[0]).toEqual({
      role: "system",
      content: "Answer in exactly one word.",
    });
  });

  it("returns the 503 not_configured JSON error before the stream starts when the prompt file is missing", async () => {
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", join(promptDir, "missing.md"));

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("not_configured");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("behaves as if unset when the configured prompt file is empty", async () => {
    const path = join(promptDir, "empty.md");
    await writeFile(path, "  \n");
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", path);
    const model = streamingModel([...textParts(["ok"]), finishPart()]);
    stubOpenRouterModel(model);

    await readFrames(await POST(streamRequest(conversation)));

    expect(model.doStreamCalls[0].prompt[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "My name is Filip." }],
    });
  });

  it("streams with the configured knowledge notes and lists them on done", async () => {
    const notesDir = join(promptDir, "notes");
    await mkdir(join(notesDir, "projects"), { recursive: true });
    await writeFile(join(notesDir, "projects", "apollo.md"), "Apollo launches on 14 March.");
    vi.stubEnv("SPEKTER_KNOWLEDGE_DIR", notesDir);
    const model = streamingModel([...textParts(["14 March."]), finishPart()], "openai/gpt-test");
    stubOpenRouterModel(model);

    const response = await POST(streamRequest(conversation));

    expect(await readFrames(response)).toEqual([
      { type: "sources", sources: [{ type: "knowledge_file", path: "projects/apollo.md" }] },
      { type: "delta", text: "14 March." },
      { type: "done", model: "openai/gpt-test", sources: [{ type: "knowledge_file", path: "projects/apollo.md" }] },
    ]);
    expect(model.doStreamCalls[0].prompt[0].content).toContain(
      '<note path="projects/apollo.md">\nApollo launches on 14 March.\n</note>',
    );
  });

  it("returns the 503 not_configured JSON error before the stream starts when the knowledge folder is missing", async () => {
    const missing = join(promptDir, "no-notes");
    vi.stubEnv("SPEKTER_KNOWLEDGE_DIR", missing);

    const response = await POST(streamRequest(conversation));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain(missing);
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

describe("POST /api/chat/stream model history", () => {
  let historyDir: string;

  beforeEach(async () => {
    historyDir = await mkdtemp(join(tmpdir(), "spekter-model-history-"));
    vi.stubEnv("SPEKTER_MODEL_HISTORY_DIR", historyDir);
  });

  afterEach(async () => {
    await rm(historyDir, { recursive: true, force: true });
  });

  it("carries prior tool calls and results into the next turn of a session", async () => {
    const model = scriptedStreamingModel([
      toolCallParts("current_time"),
      [...textParts(["It is Monday."]), finishPart()],
    ]);
    stubOpenRouterModel(model);

    await readFrames(await POST(streamRequest({ messages: [{ role: "user", content: "what day is it?" }], sessionId: "s1" })));
    await readFrames(
      await POST(
        streamRequest({
          messages: [
            { role: "user", content: "what day is it?" },
            { role: "assistant", content: "It is Monday." },
            { role: "user", content: "and tomorrow?" },
          ],
          sessionId: "s1",
        }),
      ),
    );

    // The second turn's prompt rebuilds from the stored transcript: tool result included.
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(prompt).toContain('"tool-result"');
    expect(prompt).toContain("call-current_time");
  });

  it("writes no history when the reply fails", async () => {
    stubOpenRouterModel(streamingModel([{ type: "error", error: new Error("upstream exploded") }]));

    await readFrames(await POST(streamRequest({ messages: [{ role: "user", content: "hi" }], sessionId: "s1" })));

    await expect(readFile(join(historyDir, "s1.json"), "utf-8")).rejects.toThrow();
  });
});
