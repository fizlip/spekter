import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors";
import { failingModel, replyingModel } from "../testing/mock-model";
import { assembleChatCall, completeChat } from "./complete";
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

  it("prepends the system prompt verbatim before the caller's messages", async () => {
    const model = replyingModel("ok");
    await completeChat(conversation, model, "# Be terse.\n");

    const [call] = model.doGenerateCalls;
    expect(call.prompt).toEqual([
      { role: "system", content: "# Be terse.\n" },
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
      { role: "assistant", content: [{ type: "text", text: "Nice to meet you, Filip." }] },
      { role: "user", content: [{ type: "text", text: "What is my name?" }] },
    ]);
  });

  it("derives the reasoning effort from the last caller message, not the system prompt", () => {
    const short = [{ role: "user", content: "Hi" }] satisfies ChatMessage[];
    const long = [{ role: "user", content: "Please think carefully about this question" }] satisfies ChatMessage[];

    const withLongPrompt = assembleChatCall(short, replyingModel("ok"), "# A long system prompt full of words");
    expect(withLongPrompt.providerOptions.openrouter.reasoning.effort).toBe("none");

    const withNoPrompt = assembleChatCall(long, replyingModel("ok"), null);
    expect(withNoPrompt.providerOptions.openrouter.reasoning.effort).toBe("medium");
  });

  it("wraps model failures in a ProviderError with the original message", async () => {
    const result = completeChat([{ role: "user", content: "Hi" }], failingModel("upstream exploded"));
    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toThrow("upstream exploded");
  });

  it("treats an empty reply as a provider error instead of a successful reply", async () => {
    const result = completeChat([{ role: "user", content: "Hi" }], replyingModel("   "));
    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toThrow("Model returned no text (finish reason: stop)");
  });

  it.each(["content-filter", "error", "other"] as const)(
    "treats a %s finish as a provider error even when some text came back",
    async (finishReason) => {
      const model = replyingModel("partial answ", finishReason);
      await expect(completeChat([{ role: "user", content: "Hi" }], model)).rejects.toThrow(
        `Model stopped without completing its reply (finish reason: ${finishReason})`,
      );
    },
  );

  it("does not carry messages from one call into the next", async () => {
    const model = replyingModel("ok");
    await completeChat([{ role: "user", content: "First" }], model);
    await completeChat([{ role: "user", content: "Second" }], model);

    expect(model.doGenerateCalls[1].prompt).toEqual([
      { role: "user", content: [{ type: "text", text: "Second" }] },
    ]);
  });
});
