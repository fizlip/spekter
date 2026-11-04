import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../errors";
import { createChatModel, LOCAL_MODEL_PREFIX, resolveModelConfig } from "./model";

const config = {
  apiKey: "sk-test",
  model: "openai/gpt-test",
  localBaseUrl: "http://127.0.0.1:8081/v1",
  localApiKey: null,
};

describe("resolveModelConfig", () => {
  it("routes a public id to OpenRouter", () => {
    expect(resolveModelConfig(config, "openai/gpt-test")).toEqual({
      provider: "openrouter",
      apiKey: "sk-test",
      model: "openai/gpt-test",
    });
  });

  it("routes a local/ id to the local server and strips the prefix", () => {
    expect(resolveModelConfig(config, `${LOCAL_MODEL_PREFIX}qwen3-8b`)).toEqual({
      provider: "local",
      baseUrl: "http://127.0.0.1:8081/v1",
      apiKey: null,
      model: "qwen3-8b",
    });
  });

  it("passes the local API key through when configured", () => {
    expect(resolveModelConfig({ ...config, localApiKey: "local-key" }, "local/x").apiKey).toBe("local-key");
  });

  it("requires OPENROUTER_API_KEY for a public model", () => {
    expect(() => resolveModelConfig({ ...config, apiKey: null }, "openai/gpt-test")).toThrow(
      new NotConfiguredError("Missing environment variable: OPENROUTER_API_KEY"),
    );
  });

  it("requires SPEKTER_LOCAL_BASE_URL for a local/ model", () => {
    expect(() => resolveModelConfig({ ...config, localBaseUrl: null }, "local/qwen")).toThrow(
      new NotConfiguredError("Missing environment variable: SPEKTER_LOCAL_BASE_URL"),
    );
  });
});

describe("createChatModel", () => {
  it("builds an OpenRouter model for a public id", () => {
    const model = createChatModel(resolveModelConfig(config, "openai/gpt-test"));
    expect(model).toMatchObject({ modelId: "openai/gpt-test" });
  });

  it("builds an openai-compatible model for a local/ id", () => {
    const model = createChatModel(resolveModelConfig(config, "local/qwen3-8b"));
    expect(model).toMatchObject({ modelId: "qwen3-8b", provider: "local.chat" });
  });
});
