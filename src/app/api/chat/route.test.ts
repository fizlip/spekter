import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { POST } from "./route";

vi.mock("@/core/models/openrouter", () => ({ createOpenRouterModel: vi.fn() }));

const conversation = {
  messages: [
    { role: "user", content: "My name is Filip." },
    { role: "assistant", content: "Nice to meet you, Filip." },
    { role: "user", content: "What is my name?" },
  ],
};

function chatRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>;

function mockModel(doGenerate: MockOptions["doGenerate"]) {
  const model = new MockLanguageModelV3({ doGenerate });
  vi.mocked(createOpenRouterModel).mockReturnValue(model);
  return model;
}

function replyWith(text: string) {
  return mockModel({
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  });
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
    replyWith("Your name is Filip.");

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

  it("returns 400 invalid_request when the conversation ends with an assistant message", async () => {
    const response = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 502 provider_error with the provider's message when the model fails", async () => {
    mockModel(async () => {
      throw new Error("Rate limit exceeded");
    });

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
    expect((await response.json()).error.code).toBe("internal_error");
  });
});
