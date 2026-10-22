import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assembleChatCall } from "../chat/complete";
import {
  finishPart,
  hangingModel,
  replyingModel,
  scriptedModel,
  scriptedStreamingModel,
  textParts,
  toolCallContent,
  toolCallParts,
} from "../testing/mock-model";
import { currentTime } from "../tools/current-time";
import type { SpekterTool } from "../tools/types";
import { aiSdkLoop } from "./ai-sdk-loop";
import type { LoopEvent } from "./loop";

const question = [{ role: "user" as const, content: "What day is it?" }];

const LAST_STEP_NOTICE =
  "(Afryend: you have used every tool call allowed for this reply, and tools are now off. Answer my request now with the information you already have, and say what you could not find out.)";

const brokenClock: SpekterTool = {
  name: "current_time",
  description: "Get the current time.",
  inputSchema: z.object({}),
  execute: async () => {
    throw new Error("clock unavailable");
  },
};

async function collect(events: AsyncIterable<LoopEvent>) {
  const collected: LoopEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("aiSdkLoop.complete", () => {
  it("calls the tool, feeds its result back, and returns the final reply", async () => {
    const model = scriptedModel([
      { content: [toolCallContent("current_time")], finishReason: "tool-calls" },
      { content: [{ type: "text", text: "It is Monday." }] },
    ]);

    const result = await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 5 });

    expect(result).toEqual({
      text: "It is Monday.",
      finishReason: "stop",
      toolCalls: [{ id: "call-current_time", name: "current_time", ok: true }],
      produced: expect.any(Array),
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].prompt.at(-1)).toMatchObject({
      role: "tool",
      content: [{ type: "tool-result", toolName: "current_time" }],
    });
  });

  it("turns tools off on the last allowed step", async () => {
    const model = scriptedModel([{ content: [toolCallContent("current_time")], finishReason: "tool-calls" }]);

    const result = await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 2 });

    expect(model.doGenerateCalls.map((call) => call.toolChoice)).toEqual([{ type: "auto" }, { type: "none" }]);
    expect(result.finishReason).toBe("tool-calls");
  });

  it("tells the model on the last step, after the tool results, that tools are off", async () => {
    const model = scriptedModel([{ content: [toolCallContent("current_time")], finishReason: "tool-calls" }]);

    await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 2 });

    const [first, last] = model.doGenerateCalls;
    expect(JSON.stringify(first.prompt)).not.toContain(LAST_STEP_NOTICE);
    expect(last.prompt.at(-2)).toMatchObject({ role: "tool" });
    expect(last.prompt.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: LAST_STEP_NOTICE }] });
  });

  it("adds the notice to the only step when the limit is one", async () => {
    const model = replyingModel("Hi.");

    await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 1 });

    expect(model.doGenerateCalls[0].prompt.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: LAST_STEP_NOTICE }] });
  });

  it("runs a limit of one as a single tool-free step", async () => {
    const model = replyingModel("Hi.");

    await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 1 });

    expect(model.doGenerateCalls.map((call) => call.toolChoice)).toEqual([{ type: "none" }]);
  });

  it("sends a failing tool's error to the model and keeps going", async () => {
    const model = scriptedModel([
      { content: [toolCallContent("current_time")], finishReason: "tool-calls" },
      { content: [{ type: "text", text: "The clock is down." }] },
    ]);

    const result = await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [brokenClock], maxSteps: 5 });

    expect(result.text).toBe("The clock is down.");
    expect(result.toolCalls).toEqual([{ id: "call-current_time", name: "current_time", ok: false }]);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("clock unavailable");
  });

  it("treats a call to an unknown tool as a failed tool result", async () => {
    const model = scriptedModel([
      { content: [toolCallContent("weather")], finishReason: "tool-calls" },
      { content: [{ type: "text", text: "I can't check the weather." }] },
    ]);

    const result = await aiSdkLoop.complete(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 5 });

    expect(result.text).toBe("I can't check the weather.");
    expect(result.toolCalls).toEqual([{ id: "call-weather", name: "weather", ok: false }]);
  });

  it("makes exactly today's single call when there are no tools", async () => {
    const model = scriptedModel([{ content: [{ type: "text", text: "Hi." }], finishReason: "tool-calls" }]);

    const result = await aiSdkLoop.complete(assembleChatCall(question, model), {});

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].tools).toBeUndefined();
    expect(result).toEqual({ text: "Hi.", finishReason: "tool-calls", toolCalls: [], produced: expect.any(Array) });
  });

  it("produces the turn's generated messages, tool calls and results included", async () => {
    const model = scriptedModel([
      { content: [toolCallContent("current_time")], finishReason: "tool-calls" },
      { content: [{ type: "text", text: "It is Monday." }] },
    ]);

    const { produced } = await aiSdkLoop.complete(assembleChatCall(question, model), {
      tools: [currentTime],
      maxSteps: 5,
    });

    expect(produced.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(JSON.stringify(produced)).toContain("call-current_time");
    expect(JSON.stringify(produced)).toContain('"tool-result"');
    expect(JSON.stringify(produced)).toContain("It is Monday.");
  });
});

describe("aiSdkLoop.stream", () => {
  it("yields the tool call, its result, then the reply text", async () => {
    const model = scriptedStreamingModel([
      toolCallParts("current_time"),
      [...textParts(["It is ", "Monday."]), finishPart()],
    ]);

    const events = await collect(
      aiSdkLoop.stream(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 5 }),
    );

    expect(events).toEqual([
      { type: "tool_call", id: "call-current_time", name: "current_time", input: {} },
      { type: "tool_result", id: "call-current_time", name: "current_time", ok: true },
      { type: "text", text: "It is " },
      { type: "text", text: "Monday." },
      { type: "finish", finishReason: "stop" },
      { type: "produced", messages: expect.any(Array) },
    ]);
  });

  it("reports a failing tool as a failed result and keeps streaming", async () => {
    const model = scriptedStreamingModel([
      toolCallParts("current_time"),
      [...textParts(["The clock is down."]), finishPart()],
    ]);

    const events = await collect(
      aiSdkLoop.stream(assembleChatCall(question, model), { tools: [brokenClock], maxSteps: 5 }),
    );

    expect(events).toContainEqual({ type: "tool_result", id: "call-current_time", name: "current_time", ok: false });
    expect(events.at(-2)).toEqual({ type: "finish", finishReason: "stop" });
  });

  it("turns tools off on the last allowed step", async () => {
    const model = scriptedStreamingModel([toolCallParts("current_time")]);

    const events = await collect(
      aiSdkLoop.stream(assembleChatCall(question, model), { tools: [currentTime], maxSteps: 2 }),
    );

    expect(model.doStreamCalls.map((call) => call.toolChoice)).toEqual([{ type: "auto" }, { type: "none" }]);
    expect(events.at(-2)).toEqual({ type: "finish", finishReason: "tool-calls" });
  });

  it("stops yielding once the abort signal fires", async () => {
    const controller = new AbortController();
    const model = hangingModel(textParts(["It is "]).slice(0, 2));
    const events: LoopEvent[] = [];

    try {
      for await (const event of aiSdkLoop.stream(assembleChatCall(question, model), {
        abortSignal: controller.signal,
      })) {
        events.push(event);
        controller.abort();
      }
    } catch {}

    expect(events.filter((event) => event.type !== "abort")).toEqual([{ type: "text", text: "It is " }]);
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  });
});
