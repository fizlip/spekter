import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
      sandboxDir: resolve(".sandbox"),
      workspaceRoot: join(homedir(), "spekter-workspace"),
      maxBoxes: 2,
      ttlSeconds: 1800,
      execDefaultSeconds: 90,
      execMaxSeconds: 600,
      caps: { cpus: 2, memoryGiB: 4, diskGiB: 20 },
    });
  });

  it("reads overrides, expanding ~ in the workspace root", () => {
    expect(
      readSandboxConfig({
        SANDBOX_TOKEN: token,
        SANDBOX_PORT: " 4321 ",
        SANDBOX_LOG: "/tmp/x.jsonl",
        SANDBOX_WORKSPACE_ROOT: "~/elsewhere",
        SANDBOX_MAX_BOXES: "3",
        SANDBOX_TTL_SECONDS: "60",
      }),
    ).toMatchObject({
      port: 4321,
      logPath: "/tmp/x.jsonl",
      workspaceRoot: join(homedir(), "elsewhere"),
      maxBoxes: 3,
      ttlSeconds: 60,
    });
  });

  it("refuses a workspace root inside the repo, where host tooling would walk guest-written files", () => {
    expect(() => readSandboxConfig({ SANDBOX_TOKEN: token, SANDBOX_WORKSPACE_ROOT: "workspace" })).toThrow(
      new SandboxError("not_configured", `SANDBOX_WORKSPACE_ROOT must be outside the project (${resolve()})`),
    );
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

  it.each(["SANDBOX_PORT", "SANDBOX_MAX_BOXES", "SANDBOX_TTL_SECONDS", "SANDBOX_EXEC_SECONDS", "SANDBOX_EXEC_MAX_SECONDS"])("rejects bad values of %s, naming the variable", (name) => {
    for (const value of ["abc", "0", "-1", "80.5"]) {
      expect(() => readSandboxConfig({ SANDBOX_TOKEN: token, [name]: value })).toThrow(
        new SandboxError("not_configured", `${name} must be a positive whole number, got "${value}"`),
      );
    }
  });
});
