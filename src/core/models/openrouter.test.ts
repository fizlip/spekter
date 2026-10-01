import { describe, expect, it } from "vitest";
import { createOpenRouterModel } from "./openrouter";

describe("createOpenRouterModel", () => {
  it("uses the configured model id", () => {
    const model = createOpenRouterModel({ apiKey: "sk-test", model: "anthropic/claude-haiku-4.5" });

    expect(model).toMatchObject({ modelId: "anthropic/claude-haiku-4.5" });
  });
});
