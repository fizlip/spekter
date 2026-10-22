import { generateText, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { DEFAULT_MAX_STEPS } from "../config";
import type { SpekterTool } from "../tools/types";
import type { AgentLoop, LoopOptions, ToolOutcome } from "./loop";

function toToolSet(tools: SpekterTool[]): ToolSet {
  return Object.fromEntries(
    tools.map(({ name, description, inputSchema, execute }) => [
      name,
      tool({ description, inputSchema, execute: (input, { abortSignal }) => execute(input, { abortSignal }) }),
    ]),
  );
}

// Without it the model, unaware tools are off, narrates its next call instead of answering.
// It goes last in that step's messages, after the tool results, so it is the latest thing read.
const LAST_STEP_NOTICE: ModelMessage = {
  role: "user",
  content:
    "(Afryend: you have used every tool call allowed for this reply, and tools are now off. Answer my request now with the information you already have, and say what you could not find out.)",
};

// No tools means exactly one plain model call, as before the loop existed.
function loopSettings({ tools = [], maxSteps = DEFAULT_MAX_STEPS }: LoopOptions) {
  if (tools.length === 0) return {};
  return {
    tools: toToolSet(tools),
    stopWhen: stepCountIs(maxSteps),
    // The last allowed step can't call tools, so the model answers with what it gathered.
    prepareStep: ({ stepNumber, messages }: { stepNumber: number; messages: ModelMessage[] }) =>
      stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const, messages: [...messages, LAST_STEP_NOTICE] } : {},
  };
}

// The AI SDK's built-in multi-step loop behind Spekter's AgentLoop seam.
export const aiSdkLoop: AgentLoop = {
  async complete(call, options) {
    const result = await generateText({ ...call, ...loopSettings(options), abortSignal: options.abortSignal });
    const toolCalls = result.steps.flatMap((step) =>
      step.content.flatMap((part): ToolOutcome[] =>
        part.type === "tool-result" || part.type === "tool-error"
          ? [{ id: part.toolCallId, name: part.toolName, ok: part.type === "tool-result" }]
          : [],
      ),
    );
    return { text: result.text, finishReason: result.finishReason, toolCalls, produced: result.response.messages };
  },

  async *stream(call, options) {
    const result = streamText({
      ...call,
      ...loopSettings(options),
      abortSignal: options.abortSignal,
      // Failures reach the caller as error events, not logs.
      onError: () => {},
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield { type: "text", text: part.text };
          break;
        case "reasoning-delta":
          yield { type: "reasoning", text: part.text };
          break;
        case "tool-call":
          yield { type: "tool_call", id: part.toolCallId, name: part.toolName, input: part.input };
          break;
        case "tool-result":
        case "tool-error":
          yield { type: "tool_result", id: part.toolCallId, name: part.toolName, ok: part.type === "tool-result" };
          break;
        case "error":
          yield { type: "error", error: part.error };
          return;
        case "abort":
          yield { type: "abort" };
          return;
        case "finish":
          yield { type: "finish", finishReason: part.finishReason };
          break;
      }
    }

    // The fullStream has ended, so the response promise is settled and its messages
    // carry every step's generated parts — including the tool calls and results a
    // persistent transcript needs to keep.
    yield { type: "produced", messages: (await result.response).messages };
  },
};
