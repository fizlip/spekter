import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readSandboxConfig } from "./config";
import { SandboxError } from "./wire";

const token = "a".repeat(32);

describe("readSandboxConfig", () => {
  it("applies defaults when only the token is set", () => {
    expect(readSandboxConfig({ SANDBOX_TOKEN: token })).toEqual({
      port: 3210,
      token,
      logPath: resolve("logs/sandboxd.jsonl"),
    });
  });

  it("reads port and log path overrides", () => {
    expect(readSandboxConfig({ SANDBOX_TOKEN: token, SANDBOX_PORT: " 4321 ", SANDBOX_LOG: "/tmp/x.jsonl" })).toMatchObject({
      port: 4321,
      logPath: "/tmp/x.jsonl",
    });
  });

  it.each([["unset", {}], ["blank", { SANDBOX_TOKEN: "   " }]])("refuses to boot when SANDBOX_TOKEN is %s", (_label, env) => {
    expect(() => readSandboxConfig(env)).toThrow(
      new SandboxError("not_configured", "Missing environment variable: SANDBOX_TOKEN"),
    );
  });

  it("refuses a token shorter than 32 characters", () => {
    expect(() => readSandboxConfig({ SANDBOX_TOKEN: "dev" })).toThrow(
      new SandboxError(
        "not_configured",
        "SANDBOX_TOKEN must be at least 32 characters; generate one with `openssl rand -hex 32`",
      ),
    );
  });

  it.each(["abc", "0", "-1", "80.5"])("rejects SANDBOX_PORT=%s, naming the variable", (value) => {
    expect(() => readSandboxConfig({ SANDBOX_TOKEN: token, SANDBOX_PORT: value })).toThrow(
      new SandboxError("not_configured", `SANDBOX_PORT must be a positive whole number, got "${value}"`),
    );
  });
});
