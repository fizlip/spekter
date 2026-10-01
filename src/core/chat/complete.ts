import { generateText, type LanguageModel } from "ai";
import { ProviderError } from "../errors";
import type { ChatMessage } from "./contract";

export async function completeChat(messages: ChatMessage[], model: LanguageModel): Promise<string> {
  try {
    const { text } = await generateText({ model, messages });
    return text;
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error));
  }
}
