import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors";
import { completeChat } from "./complete";
import type { ChatMessage } from "./contract";

function replyingModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

const conversation: ChatMessage[] = [
  { role: "user", content: "My name is Filip." },
  { role: "assistant", content: "Nice to meet you, Filip." },
  { role: "user", content: "What is my name?" },
];

describe("completeChat", () => {
  it("returns the model's reply text", async () => {
    await expect(completeChat(conversation, replyingModel("Your name is Filip."))).resolves.toBe(
      "Your name is Filip.",
    );
  });

  it("sends the caller's messages in order with no system prompt or tools", async () => {
    const model = replyingModel("ok");
    await completeChat(conversation, model);

    const [call] = model.doGenerateCalls;
    expect(call.prompt).toEqual([
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
      { role: "assistant", content: [{ type: "text", text: "Nice to meet you, Filip." }] },
      { role: "user", content: [{ type: "text", text: "What is my name?" }] },
    ]);
    expect(call.tools).toBeUndefined();
  });

  it("wraps model failures in a ProviderError with the original message", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("upstream exploded");
      },
    });

    const result = completeChat([{ role: "user", content: "Hi" }], model);
    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toThrow("upstream exploded");
  });

  it("does not carry messages from one call into the next", async () => {
    const model = replyingModel("ok");
    await completeChat([{ role: "user", content: "First" }], model);
    await completeChat([{ role: "user", content: "Second" }], model);

    expect(model.doGenerateCalls[1].prompt).toEqual([
      { role: "user", content: [{ type: "text", text: "Second" }] },
    ]);
  });
});
