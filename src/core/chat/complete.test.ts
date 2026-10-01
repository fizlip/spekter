import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors";
import { failingModel, replyingModel } from "../testing/mock-model";
import { completeChat } from "./complete";
import type { ChatMessage } from "./contract";

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
    const result = completeChat([{ role: "user", content: "Hi" }], failingModel("upstream exploded"));
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
