import { MockLanguageModelV3 } from "ai/test";

type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>;

export function mockModel(doGenerate: MockOptions["doGenerate"]) {
  return new MockLanguageModelV3({ doGenerate });
}

export function replyingModel(text: string) {
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

export function failingModel(message: string) {
  return mockModel(async () => {
    throw new Error(message);
  });
}
