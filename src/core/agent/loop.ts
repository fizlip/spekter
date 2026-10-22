import type { FinishReason, LanguageModel, ModelMessage, SystemModelMessage } from "ai";
import type { SpekterTool } from "../tools/types";

// The model call the assembly point builds; a loop runs it, possibly over several steps.
export type ModelCall = {
  model: LanguageModel;
  system?: string | SystemModelMessage[];
  messages: ModelMessage[];
  providerOptions: {
    openrouter: { reasoning: { effort: "medium" | "none" } };
  };
};

export type LoopOptions = {
  tools?: SpekterTool[];
  // Most model steps per request; the last one runs with tools off so the model must answer.
  maxSteps?: number;
  abortSignal?: AbortSignal;
};

export type ToolOutcome = { id: string; name: string; ok: boolean };

export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | ({ type: "tool_result" } & ToolOutcome)
  // The messages the turn generated (assistant text, tool calls and results), for
  // callers that persist the model-facing transcript across turns. Follows "finish".
  | { type: "produced"; messages: ModelMessage[] }
  | { type: "error"; error: unknown }
  | { type: "abort" }
  | { type: "finish"; finishReason: FinishReason };

// The seam every agent loop Brick implements. Callers depend on this, never on a loop library.
export type AgentLoop = {
  complete(
    call: ModelCall,
    options: LoopOptions,
  ): Promise<{ text: string; finishReason: FinishReason; toolCalls: ToolOutcome[]; produced: ModelMessage[] }>;
  stream(call: ModelCall, options: LoopOptions): AsyncIterable<LoopEvent>;
};
