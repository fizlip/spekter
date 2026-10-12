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

const notes = [
  { path: "people/filip.md", content: "Filip lives in Stockholm.\n" },
  { path: "projects/apollo.md", content: "Apollo launches on 14 March." },
];

const knowledgeMessage = {
  role: "system",
  content: [
    "Knowledge notes. Each note starts with its path in the notes folder.",
    '<note path="people/filip.md">\nFilip lives in Stockholm.\n\n</note>',
    '<note path="projects/apollo.md">\nApollo launches on 14 March.\n</note>',
  ].join("\n\n"),
};

describe("completeChat", () => {
  it("returns the model's reply text with no sources when no knowledge is given", async () => {
    await expect(completeChat(conversation, replyingModel("Your name is Filip."))).resolves.toEqual({
      text: "Your name is Filip.",
      sources: [],
    });
  });

  it("sends the knowledge notes as their own system message after the system prompt", async () => {
    const model = replyingModel("ok");
    await completeChat(conversation, model, { systemPrompt: "# Be terse.\n", knowledge: notes });

    const [call] = model.doGenerateCalls;
    expect(call.prompt).toEqual([
      { role: "system", content: "# Be terse.\n" },
      knowledgeMessage,
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
      { role: "assistant", content: [{ type: "text", text: "Nice to meet you, Filip." }] },
      { role: "user", content: [{ type: "text", text: "What is my name?" }] },
    ]);
  });

  it("sends the knowledge message first when there is no system prompt", async () => {
    const model = replyingModel("ok");
    await completeChat(conversation, model, { knowledge: notes });

    const [call] = model.doGenerateCalls;
    expect(call.prompt[0]).toEqual(knowledgeMessage);
    expect(call.prompt[1]).toEqual({ role: "user", content: [{ type: "text", text: "My name is Filip." }] });
  });

  it("returns one knowledge_file source per note, in note order", async () => {
    await expect(completeChat(conversation, replyingModel("ok"), { knowledge: notes })).resolves.toEqual({
      text: "ok",
      sources: [
        { type: "knowledge_file", path: "people/filip.md" },
        { type: "knowledge_file", path: "projects/apollo.md" },
      ],
    });
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
    await completeChat(conversation, model, { systemPrompt: "# Be terse.\n" });

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

    const withLongPrompt = assembleChatCall(short, replyingModel("ok"), {
      systemPrompt: "# A long system prompt full of words",
      knowledge: [{ path: "long.md", content: "Please think carefully about this long note full of words" }],
    });
    expect(withLongPrompt.providerOptions.openrouter.reasoning.effort).toBe("none");

    const withNoPrompt = assembleChatCall(long, replyingModel("ok"), { systemPrompt: null });
    expect(withNoPrompt.providerOptions.openrouter.reasoning.effort).toBe("medium");
  });

  it("wraps model failures in a ProviderError with the original message", async () => {
    const result = completeChat([{ role: "user", content: "Hi" }], failingModel("upstream exploded"));
    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toThrow("upstream exploded");
  });

  it("explains a context overflow with the note count, size, and knowledge variable", async () => {
    const raw =
      "This endpoint's maximum context length is 200000 tokens. However, you requested about 250000 tokens";
    const result = completeChat(conversation, failingModel(raw), { knowledge: notes });

    await expect(result).rejects.toBeInstanceOf(ProviderError);
    await expect(result).rejects.toThrow(
      `The conversation and 2 knowledge notes (0.1 KB, from SPEKTER_KNOWLEDGE_DIR) exceed the model's context limit. Provider said: ${raw}`,
    );
  });

  it("explains a context overflow without mentioning knowledge when no notes were sent", async () => {
    const raw = "prompt is too long: 250000 tokens > 200000 maximum";

    await expect(completeChat(conversation, failingModel(raw))).rejects.toThrow(
      `The conversation exceeds the model's context limit. Provider said: ${raw}`,
    );
  });

  it("keeps a tokens-per-minute rate limit as the provider's message, not a context overflow", async () => {
    const raw = "Rate limit reached: too many tokens per minute";

    await expect(completeChat(conversation, failingModel(raw), { knowledge: notes })).rejects.toThrow(
      new ProviderError(raw),
    );
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
