import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { Config } from "../config";

export function createOpenRouterModel({ apiKey, model }: Config): LanguageModel {
  return createOpenRouter({ apiKey }).chat(model);
}
