import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export function createOpenRouterModel({ apiKey, model }: { apiKey: string; model: string }): LanguageModel {
  return createOpenRouter({ apiKey }).chat(model);
}
