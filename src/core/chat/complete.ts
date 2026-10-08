import { generateText, type FinishReason, type LanguageModel, type ModelMessage } from "ai";
import { ProviderError } from "../errors";
import type { ChatMessage } from "./contract";
import { needsReasoning } from "./reasoning";

const INCOMPLETE_FINISH_REASONS: ReadonlySet<FinishReason> = new Set(["content-filter", "error", "other"]);

// The one place both endpoints build the model call; system prompt, knowledge and tools attach here.
export function assembleChatCall(messages: ChatMessage[], model: LanguageModel): {
  model: LanguageModel;
  messages: ModelMessage[];
  providerOptions: {
    openrouter: { reasoning: { effort: "medium" | "none" } };
  };
} {
  const effort = needsReasoning(messages) ? ("medium" as const) : ("none" as const);
  return { model, messages, providerOptions: { openrouter: { reasoning: { effort } } } };
}

export function incompleteReplyReason(text: string, finishReason: FinishReason): string | undefined {
  if (INCOMPLETE_FINISH_REASONS.has(finishReason)) {
    return `Model stopped without completing its reply (finish reason: ${finishReason})`;
  }
  if (!text.trim()) return `Model returned no text (finish reason: ${finishReason})`;
}

export function toProviderError(error: unknown): ProviderError {
  return new ProviderError(error instanceof Error ? error.message : String(error));
}

export async function completeChat(messages: ChatMessage[], model: LanguageModel): Promise<string> {
  let result;
  try {
    result = await generateText(assembleChatCall(messages, model));
  } catch (error) {
    throw toProviderError(error);
  }

  const { text, finishReason } = result;
  const problem = incompleteReplyReason(text, finishReason);
  if (problem) throw new ProviderError(problem);
  return text;
}
