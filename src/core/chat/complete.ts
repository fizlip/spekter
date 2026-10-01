import { generateText, type FinishReason, type LanguageModel } from "ai";
import { ProviderError } from "../errors";
import type { ChatMessage } from "./contract";

const INCOMPLETE_FINISH_REASONS: ReadonlySet<FinishReason> = new Set(["content-filter", "error", "other"]);

export async function completeChat(messages: ChatMessage[], model: LanguageModel): Promise<string> {
  let result;
  try {
    result = await generateText({ model, messages });
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error));
  }

  const { text, finishReason } = result;
  if (INCOMPLETE_FINISH_REASONS.has(finishReason)) {
    throw new ProviderError(`Model stopped without completing its reply (finish reason: ${finishReason})`);
  }
  if (!text.trim()) {
    throw new ProviderError(`Model returned no text (finish reason: ${finishReason})`);
  }
  return text;
}
