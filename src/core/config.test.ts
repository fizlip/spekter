import { describe, expect, it } from "vitest";
import { readConfig, readConfiguredModel } from "./config";
import { NotConfiguredError } from "./errors";

describe("readConfig", () => {
  it("returns the API key and model id when both are set", () => {
    expect(
      readConfig({ OPENROUTER_API_KEY: "sk-test", SPEKTER_MODEL: "openai/gpt-test" }),
    ).toEqual({ apiKey: "sk-test", model: "openai/gpt-test" });
  });

  it("names OPENROUTER_API_KEY when it is missing", () => {
    expect(() => readConfig({ SPEKTER_MODEL: "openai/gpt-test" })).toThrow(
      new NotConfiguredError("Missing environment variable: OPENROUTER_API_KEY"),
    );
  });

  it("names SPEKTER_MODEL when it is missing", () => {
    expect(() => readConfig({ OPENROUTER_API_KEY: "sk-test" })).toThrow(
      new NotConfiguredError("Missing environment variable: SPEKTER_MODEL"),
    );
  });

  it("names both variables when both are missing", () => {
    expect(() => readConfig({})).toThrow(
      new NotConfiguredError("Missing environment variables: OPENROUTER_API_KEY, SPEKTER_MODEL"),
    );
  });

  it("treats empty strings as missing", () => {
    expect(() => readConfig({ OPENROUTER_API_KEY: "", SPEKTER_MODEL: "  " })).toThrow(
      NotConfiguredError,
    );
  });
});

describe("readConfiguredModel", () => {
  it("returns the trimmed model id when set", () => {
    expect(readConfiguredModel({ SPEKTER_MODEL: " openai/gpt-test " })).toBe("openai/gpt-test");
  });

  it.each([["unset", {}], ["whitespace", { SPEKTER_MODEL: "  " }]])("returns null when %s", (_label, env) => {
    expect(readConfiguredModel(env)).toBeNull();
  });
});
