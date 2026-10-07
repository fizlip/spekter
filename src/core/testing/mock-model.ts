import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>;
type StreamResult = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
export type MockStreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

export function mockModel(doGenerate: MockOptions["doGenerate"]) {
  return new MockLanguageModelV3({ doGenerate });
}

type FinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function replyingModel(text: string, finishReason: FinishReason = "stop") {
  return mockModel({
    content: [{ type: "text", text }],
    finishReason: { unified: finishReason, raw: finishReason },
    usage,
    warnings: [],
  });
}

export function failingModel(message: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error(message);
    },
    doStream: async () => {
      throw new Error(message);
    },
  });
}

export function textParts(deltas: string[]): MockStreamPart[] {
  return [
    { type: "text-start", id: "text-1" },
    ...deltas.map((delta): MockStreamPart => ({ type: "text-delta", id: "text-1", delta })),
    { type: "text-end", id: "text-1" },
  ];
}

export function finishPart(finishReason: FinishReason = "stop"): MockStreamPart {
  return { type: "finish", finishReason: { unified: finishReason, raw: finishReason }, usage };
}

export function streamingModel(parts: MockStreamPart[], modelId?: string) {
  return new MockLanguageModelV3({
    modelId,
    doStream: async () => ({ stream: simulateReadableStream({ chunks: parts }) }),
  });
}

// Emits `parts`, then holds the stream open until the call's abort signal fires.
export function hangingModel(parts: MockStreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<MockStreamPart>({
        start(controller) {
          parts.forEach((part) => controller.enqueue(part));
          abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
        },
      }),
    }),
  });
}
