import { readFile } from "node:fs/promises";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { failingModel, replyingModel } from "@/core/testing/mock-model";
import { POST } from "./route";
import { useTempRequestLog, waitForLogEntries } from "@/core/testing/request-log";

vi.mock("@/core/models/openrouter", () => ({ createOpenRouterModel: vi.fn() }));

const log = useTempRequestLog();

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

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("SPEKTER_MODEL", "openai/gpt-test");
});

afterEach(() => {
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
