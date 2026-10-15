import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { failingModel, replyingModel } from "@/core/testing/mock-model";
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

function chatRequest(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stubOpenRouterModel(model: LanguageModel) {
  vi.mocked(createOpenRouterModel).mockReturnValue(model);
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

describe("POST /api/chat", () => {
  it("returns the complete assistant reply for a multi-turn conversation", async () => {
    stubOpenRouterModel(replyingModel("Your name is Filip."));

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: { role: "assistant", content: "Your name is Filip." },
      model: "openai/gpt-test",
      sources: [],
    });
    expect(createOpenRouterModel).toHaveBeenCalledWith({
      apiKey: "sk-test",
      model: "openai/gpt-test",
    });
  });

  it("returns 503 not_configured without calling the model when the API key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const response = await POST(chatRequest(conversation));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("OPENROUTER_API_KEY");
    expect(body).not.toHaveProperty("message");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("offers the built-in current_time tool to the model", async () => {
    const model = replyingModel("Hi.");
    stubOpenRouterModel(model);

    await POST(chatRequest(conversation));

    expect(model.doGenerateCalls[0].tools?.map((tool) => tool.name)).toEqual([
      "current_time",
      "list_files",
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
    ]);
  });

  it("returns 503 not_configured naming SPEKTER_MAX_STEPS without calling the model when it is invalid", async () => {
    vi.stubEnv("SPEKTER_MAX_STEPS", "zero");

    const response = await POST(chatRequest(conversation));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("SPEKTER_MAX_STEPS");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("sends the configured system prompt to the model and keeps the success shape", async () => {
    const path = join(promptDir, "prompt.md");
    await writeFile(path, "Answer in exactly one word.");
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", path);
    const model = replyingModel("Word.");
    stubOpenRouterModel(model);

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: { role: "assistant", content: "Word." },
      model: "openai/gpt-test",
      sources: [],
    });
    expect(model.doGenerateCalls[0].prompt[0]).toEqual({
      role: "system",
      content: "Answer in exactly one word.",
    });
  });

  it("returns 503 not_configured naming the file without calling the model when the prompt file is missing", async () => {
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", join(promptDir, "missing.md"));

    const response = await POST(chatRequest(conversation));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("missing.md");
    expect(body).not.toHaveProperty("message");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("behaves as if unset when the configured prompt file is empty", async () => {
    const path = join(promptDir, "empty.md");
    await writeFile(path, "  \n");
    vi.stubEnv("SPEKTER_SYSTEM_PROMPT", path);
    const model = replyingModel("ok");
    stubOpenRouterModel(model);

    await POST(chatRequest(conversation));

    expect(model.doGenerateCalls[0].prompt[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "My name is Filip." }],
    });
  });

  it("sends the configured knowledge notes to the model and lists them as sources", async () => {
    const notesDir = join(promptDir, "notes");
    await mkdir(join(notesDir, "projects"), { recursive: true });
    await writeFile(join(notesDir, "projects", "apollo.md"), "Apollo launches on 14 March.");
    vi.stubEnv("SPEKTER_KNOWLEDGE_DIR", notesDir);
    const model = replyingModel("14 March.");
    stubOpenRouterModel(model);

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: { role: "assistant", content: "14 March." },
      model: "openai/gpt-test",
      sources: [{ type: "knowledge_file", path: "projects/apollo.md" }],
    });
    expect(model.doGenerateCalls[0].prompt[0]).toMatchObject({ role: "system" });
    expect(model.doGenerateCalls[0].prompt[0].content).toContain(
      '<note path="projects/apollo.md">\nApollo launches on 14 March.\n</note>',
    );
  });

  it("sends the edited note on the next request without a restart", async () => {
    const notesDir = join(promptDir, "notes");
    await mkdir(notesDir);
    await writeFile(join(notesDir, "apollo.md"), "Apollo launches on 14 March.");
    vi.stubEnv("SPEKTER_KNOWLEDGE_DIR", notesDir);
    const model = replyingModel("ok");
    stubOpenRouterModel(model);

    await POST(chatRequest(conversation));
    await writeFile(join(notesDir, "apollo.md"), "Apollo launches on 21 March.");
    await POST(chatRequest(conversation));

    expect(model.doGenerateCalls[1].prompt[0].content).toContain("Apollo launches on 21 March.");
    expect(model.doGenerateCalls[1].prompt[0].content).not.toContain("14 March");
  });

  it("returns 503 not_configured naming the folder without calling the model when the knowledge folder is missing", async () => {
    const missing = join(promptDir, "no-notes");
    vi.stubEnv("SPEKTER_KNOWLEDGE_DIR", missing);

    const response = await POST(chatRequest(conversation));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain(missing);
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request without calling the model for an empty conversation", async () => {
    const response = await POST(chatRequest({ messages: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(createOpenRouterModel).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request for a body that is not JSON", async () => {
    const response = await POST(chatRequest("not json"));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 502 provider_error when the model returns an empty reply", async () => {
    stubOpenRouterModel(replyingModel(""));

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("provider_error");
  });

  it("returns 400 invalid_request when the conversation ends with an assistant message", async () => {
    const response = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 502 provider_error with the provider's message when the model fails", async () => {
    stubOpenRouterModel(failingModel("Rate limit exceeded"));

    const response = await POST(chatRequest(conversation));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: "provider_error", message: "Rate limit exceeded" } });
  });

  it("returns 500 internal_error for unexpected failures", async () => {
    vi.mocked(createOpenRouterModel).mockImplementation(() => {
      throw new Error("boom");
    });

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Unexpected server error" },
    });
  });
});

describe("POST /api/chat request log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function onlyEntry() {
    const [entry] = await waitForLogEntries(log.path);
    return entry;
  }

  it("records one reply entry for a successful request", async () => {
    stubOpenRouterModel(replyingModel("Your name is Filip."));

    await POST(chatRequest(conversation));

    expect(await onlyEntry()).toMatchObject({ endpoint: "chat", model: "openai/gpt-test", outcome: "reply" });
  });

  it("records not_configured with the configured model when the API key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await POST(chatRequest(conversation));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "not_configured", model: "openai/gpt-test" });
  });

  it("records invalid_request for an empty conversation", async () => {
    await POST(chatRequest({ messages: [] }));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "invalid_request" });
  });

  it("records provider_error when the model fails", async () => {
    stubOpenRouterModel(failingModel("Rate limit exceeded"));

    await POST(chatRequest(conversation));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "provider_error" });
  });

  it("records internal_error for unexpected failures", async () => {
    vi.mocked(createOpenRouterModel).mockImplementation(() => {
      throw new Error("boom");
    });

    await POST(chatRequest(conversation));

    expect(await onlyEntry()).toMatchObject({ outcome: "error", errorCode: "internal_error" });
  });

  it("never writes message content to the log", async () => {
    stubOpenRouterModel(replyingModel("Your name is Filip."));

    await POST(chatRequest(conversation));
    await onlyEntry();

    expect(await readFile(log.path, "utf8")).not.toContain("Filip");
  });

  it("still returns the reply when the log cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SPEKTER_REQUEST_LOG", log.dir);
    stubOpenRouterModel(replyingModel("Your name is Filip."));

    const response = await POST(chatRequest(conversation));

    expect(response.status).toBe(200);
    expect((await response.json()).message.content).toBe("Your name is Filip.");
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
  });
});
