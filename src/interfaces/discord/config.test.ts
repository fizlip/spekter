import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "@/core/errors";
import { readDiscordConfig } from "./config";

const required = {
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_ALLOWED_USER_ID: "123456789",
};

describe("readDiscordConfig", () => {
  it("returns the token and allowed user id with defaults applied", () => {
    expect(readDiscordConfig(required)).toEqual({
      token: "bot-token",
      allowedUserId: "123456789",
      apiUrl: "http://127.0.0.1:3000",
      historyLimit: 50,
    });
  });

  it("names DISCORD_BOT_TOKEN when it is missing", () => {
    expect(() => readDiscordConfig({ DISCORD_ALLOWED_USER_ID: "1" })).toThrow(
      new NotConfiguredError("Missing environment variable: DISCORD_BOT_TOKEN"),
    );
  });

  it("names DISCORD_ALLOWED_USER_ID when it is missing", () => {
    expect(() => readDiscordConfig({ DISCORD_BOT_TOKEN: "t" })).toThrow(
      new NotConfiguredError("Missing environment variable: DISCORD_ALLOWED_USER_ID"),
    );
  });

  it("names both variables when both are missing", () => {
    expect(() => readDiscordConfig({})).toThrow(
      new NotConfiguredError(
        "Missing environment variables: DISCORD_BOT_TOKEN, DISCORD_ALLOWED_USER_ID",
      ),
    );
  });

  it("treats empty strings as missing", () => {
    expect(() =>
      readDiscordConfig({ DISCORD_BOT_TOKEN: "  ", DISCORD_ALLOWED_USER_ID: "" }),
    ).toThrow(NotConfiguredError);
  });

  it("reads an API URL override", () => {
    expect(readDiscordConfig({ ...required, SPEKTER_API_URL: " http://127.0.0.1:4242 " }).apiUrl).toBe(
      "http://127.0.0.1:4242",
    );
  });

  it.each([["unset", {}], ["blank", { DISCORD_HISTORY_LIMIT: "  " }]])(
    "defaults the history limit to 50 when %s",
    (_label, env) => {
      expect(readDiscordConfig({ ...required, ...env }).historyLimit).toBe(50);
    },
  );

  it("reads a positive whole-number history limit", () => {
    expect(readDiscordConfig({ ...required, DISCORD_HISTORY_LIMIT: " 20 " }).historyLimit).toBe(20);
  });

  it.each(["0", "-1", "2.5", "ten", "20x"])("rejects a history limit of %s, naming the variable", (value) => {
    expect(() =>
      readDiscordConfig({ ...required, DISCORD_HISTORY_LIMIT: value }),
    ).toThrow(
      new NotConfiguredError(`DISCORD_HISTORY_LIMIT must be a positive whole number, got "${value}"`),
    );
  });
});
