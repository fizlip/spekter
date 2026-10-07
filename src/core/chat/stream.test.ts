import { describe, expect, it } from "vitest";
import {
  failingModel,
  finishPart,
  hangingModel,
  streamingModel,
  textParts,
} from "../testing/mock-model";
import type { ChatMessage } from "./contract";
import { streamChat } from "./stream";
import type { ChatStreamFrame } from "./stream-frames";

const conversation: ChatMessage[] = [
  { role: "user", content: "My name is Filip." },
  { role: "assistant", content: "Nice to meet you, Filip." },
  { role: "user", content: "What is my name?" },
];

async function collect(frames: AsyncIterable<ChatStreamFrame>) {
  const collected: ChatStreamFrame[] = [];
  for await (const frame of frames) collected.push(frame);
  return collected;
}

describe("streamChat", () => {
  it("yields each text delta in order, then done with the model id", async () => {
    const model = streamingModel([...textParts(["Your name ", "is Filip."]), finishPart()], "openai/gpt-test");

    expect(await collect(streamChat(conversation, model))).toEqual([
      { type: "delta", text: "Your name " },
      { type: "delta", text: "is Filip." },
      { type: "done", model: "openai/gpt-test" },
    ]);
  });

  it("sends the caller's messages in order with no system prompt or tools", async () => {
    const model = streamingModel([...textParts(["ok"]), finishPart()]);
    await collect(streamChat(conversation, model));

    const [call] = model.doStreamCalls;
    expect(call.prompt).toEqual([
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
      { role: "assistant", content: [{ type: "text", text: "Nice to meet you, Filip." }] },
      { role: "user", content: [{ type: "text", text: "What is my name?" }] },
    ]);
    expect(call.tools).toBeUndefined();
  });

  it("still completes when the model stops at its length limit", async () => {
    const model = streamingModel([...textParts(["A long answ"]), finishPart("length")], "m");

    expect(await collect(streamChat(conversation, model))).toEqual([
      { type: "delta", text: "A long answ" },
      { type: "done", model: "m" },
    ]);
  });

  it("ends with one error frame carrying the provider message when the stream fails midway", async () => {
    const model = streamingModel([
      ...textParts(["Your name "]),
      { type: "error", error: new Error("upstream exploded") },
      finishPart("error"),
    ]);

    expect(await collect(streamChat(conversation, model))).toEqual([
      { type: "delta", text: "Your name " },
      { type: "error", code: "provider_error", message: "upstream exploded" },
    ]);
  });

  it("yields a single error frame when the model call fails before streaming", async () => {
    expect(await collect(streamChat(conversation, failingModel("Rate limit exceeded")))).toEqual([
      { type: "error", code: "provider_error", message: "Rate limit exceeded" },
    ]);
  });

  it("treats a reply with no text as an error, not done", async () => {
    const model = streamingModel([...textParts(["  "]), finishPart()]);

    expect((await collect(streamChat(conversation, model))).at(-1)).toEqual({
      type: "error",
      code: "provider_error",
      message: "Model returned no text (finish reason: stop)",
    });
  });

  it.each(["content-filter", "error", "other"] as const)(
    "treats a %s finish as an error even when text was streamed",
    async (finishReason) => {
      const model = streamingModel([...textParts(["partial answ"]), finishPart(finishReason)]);

      expect(await collect(streamChat(conversation, model))).toEqual([
        { type: "delta", text: "partial answ" },
        {
          type: "error",
          code: "provider_error",
          message: `Model stopped without completing its reply (finish reason: ${finishReason})`,
        },
      ]);
    },
  );

  it("passes the abort signal to the model and ends silently when it fires", async () => {
    const controller = new AbortController();
    const model = hangingModel(textParts(["Your name "]).slice(0, 2));
    const frames: ChatStreamFrame[] = [];

    for await (const frame of streamChat(conversation, model, controller.signal)) {
      frames.push(frame);
      controller.abort();
    }

    expect(frames).toEqual([{ type: "delta", text: "Your name " }]);
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  });
});
