import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Config } from "../config";
import { NotConfiguredError } from "../errors";
import { createOpenRouterModel } from "./openrouter";

// A model id carrying this prefix runs against the local OpenAI-compatible
// server (SPEKTER_LOCAL_BASE_URL); everything else goes through OpenRouter.
export const LOCAL_MODEL_PREFIX = "local/";

export type ModelConfig =
  | { provider: "openrouter"; apiKey: string; model: string }
  | { provider: "local"; baseUrl: string; apiKey: string | null; model: string };

export function resolveModelConfig(config: Config, modelId: string): ModelConfig {
  if (modelId.startsWith(LOCAL_MODEL_PREFIX)) {
    if (!config.localBaseUrl) {
      throw new NotConfiguredError("Missing environment variable: SPEKTER_LOCAL_BASE_URL");
    }
    return {
      provider: "local",
      baseUrl: config.localBaseUrl,
      apiKey: config.localApiKey,
      model: modelId.slice(LOCAL_MODEL_PREFIX.length),
    };
  }
  if (!config.apiKey) {
    throw new NotConfiguredError("Missing environment variable: OPENROUTER_API_KEY");
  }
  return { provider: "openrouter", apiKey: config.apiKey, model: modelId };
}

export function createChatModel(config: ModelConfig): LanguageModel {
  if (config.provider === "local") {
    return createOpenAICompatible({
      name: "local",
      baseURL: config.baseUrl,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    }).chatModel(config.model);
  }
  return createOpenRouterModel({ apiKey: config.apiKey, model: config.model });
}
