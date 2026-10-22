import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  failingModel,
  finishPart,
  hangingModel,
  scriptedStreamingModel,
  streamingModel,
  textParts,
  toolCallParts,
} from "../testing/mock-model";
import { currentTime } from "../tools/current-time";
import { streamChat } from "./stream";
import type { ChatStreamFrame } from "./stream-frames";

const conversation: ModelMessage[] = [
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
      { type: "done", model: "openai/gpt-test", sources: [] },
    ]);
  });

  it("sends the knowledge notes as their own system message and lists them on done", async () => {
    const model = streamingModel([...textParts(["ok"]), finishPart()], "m");
    const notes = [{ path: "projects/apollo.md", content: "Apollo launches on 14 March." }];

    const frames = await collect(streamChat(conversation, model, { systemPrompt: "# Be terse.\n", knowledge: notes }));

    expect(model.doStreamCalls[0].prompt.slice(0, 3)).toEqual([
      { role: "system", content: "# Be terse.\n" },
      {
        role: "system",
        content:
          'Knowledge notes. Each note starts with its path in the notes folder.\n\n<note path="projects/apollo.md">\nApollo launches on 14 March.\n</note>',
      },
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
    ]);
    expect(frames).toEqual([
      { type: "sources", sources: [{ type: "knowledge_file", path: "projects/apollo.md" }] },
      { type: "delta", text: "ok" },
      { type: "done", model: "m", sources: [{ type: "knowledge_file", path: "projects/apollo.md" }] },
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

  it("prepends the system prompt verbatim before the caller's messages", async () => {
    const model = streamingModel([...textParts(["ok"]), finishPart()]);
    await collect(streamChat(conversation, model, { systemPrompt: "# Be terse.\n" }));

    const [call] = model.doStreamCalls;
    expect(call.prompt).toEqual([
      { role: "system", content: "# Be terse.\n" },
      { role: "user", content: [{ type: "text", text: "My name is Filip." }] },
      { role: "assistant", content: [{ type: "text", text: "Nice to meet you, Filip." }] },
      { role: "user", content: [{ type: "text", text: "What is my name?" }] },
    ]);
  });

  it("still completes when the model stops at its length limit", async () => {
    const model = streamingModel([...textParts(["A long answ"]), finishPart("length")], "m");

    expect(await collect(streamChat(conversation, model))).toEqual([
      { type: "delta", text: "A long answ" },
      { type: "done", model: "m", sources: [] },
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

  it("ends with one error frame explaining a context overflow", async () => {
    const raw = "This endpoint's maximum context length is 200000 tokens.";
    const model = streamingModel([{ type: "error", error: new Error(raw) }]);
    const notes = [{ path: "big.md", content: "x".repeat(2048) }];

    expect(await collect(streamChat(conversation, model, { knowledge: notes }))).toEqual([
      { type: "sources", sources: [{ type: "knowledge_file", path: "big.md" }] },
      {
        type: "error",
        code: "provider_error",
        message: `The conversation and 1 knowledge note (2.0 KB, from SPEKTER_KNOWLEDGE_DIR) exceed the model's context limit. Provider said: ${raw}`,
      },
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

  it.each(["content-filter", "error", "other", "tool-calls"] as const)(
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

    for await (const frame of streamChat(conversation, model, {}, controller.signal)) {
      frames.push(frame);
      controller.abort();
    }

    expect(frames).toEqual([{ type: "delta", text: "Your name " }]);
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  });
});

describe("streamChat with tools", () => {
  const question: ModelMessage[] = [{ role: "user", content: "What is today's date?" }];

  it("announces the tool call and its result, then streams the reply and lists the tool on done", async () => {
    const notes = [{ path: "projects/apollo.md", content: "Apollo launches on 14 March." }];
    const model = scriptedStreamingModel([
      toolCallParts("current_time"),
      [...textParts(["It is ", "12 October."]), finishPart()],
    ]);

    expect(await collect(streamChat(question, model, { knowledge: notes, tools: [currentTime], maxSteps: 5 }))).toEqual([
      { type: "sources", sources: [{ type: "knowledge_file", path: "projects/apollo.md" }] },
      { type: "tool_call", id: "call-current_time", name: "current_time", input: {} },
      { type: "tool_result", id: "call-current_time", name: "current_time", ok: true },
      { type: "delta", text: "It is " },
      { type: "delta", text: "12 October." },
      {
        type: "done",
        model: "mock-model-id",
        sources: [
          { type: "knowledge_file", path: "projects/apollo.md" },
          { type: "tool", name: "current_time" },
        ],
      },
    ]);
  });

  it("reports a failed tool and still finishes the reply without listing it", async () => {
    const model = scriptedStreamingModel([
      toolCallParts("weather"),
      [...textParts(["I can't check the weather."]), finishPart()],
    ]);

    const frames = await collect(streamChat(question, model, { tools: [currentTime], maxSteps: 5 }));

    expect(frames).toContainEqual({ type: "tool_result", id: "call-weather", name: "weather", ok: false });
    expect(frames.at(-1)).toEqual({ type: "done", model: "mock-model-id", sources: [] });
  });

  it("ends with an error frame when the model still wants tools after the last step", async () => {
    const model = scriptedStreamingModel([toolCallParts("current_time")]);

    const frames = await collect(streamChat(question, model, { tools: [currentTime], maxSteps: 2 }));

    expect(frames.at(-1)).toEqual({
      type: "error",
      code: "provider_error",
      message: "Model stopped without completing its reply (finish reason: tool-calls)",
    });
  });

  it("returns the turn's produced messages, tool calls and results included", async () => {
    const model = scriptedStreamingModel([
      toolCallParts("current_time"),
      [...textParts(["It is Monday."]), finishPart()],
    ]);

    const frames = streamChat(question, model, { tools: [currentTime], maxSteps: 5 });
    let step = await frames.next();
    while (!step.done) step = await frames.next();

    expect(step.value?.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(JSON.stringify(step.value)).toContain('"tool-result"');
  });
});
