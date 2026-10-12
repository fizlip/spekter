import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.meta";
import { parseCommands } from "./commands";

describe("parseCommands", () => {
  it("returns no commands for plain text", () => {
    expect(parseCommands("summarize this")).toEqual({ commands: [], text: "summarize this" });
  });

  it("parses a leading command and strips it from the text", () => {
    const { commands, text } = parseCommands("/smart what is recursion");
    expect(commands).toEqual([COMMANDS.find((c) => c.name === "smart")]);
    expect(text).toBe("what is recursion");
  });

  it("parses a mid-message command", () => {
    const { commands, text } = parseCommands("summarize this /smart please");
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("smart");
    expect(text).toBe("summarize this please");
  });

  it("collects multiple commands in order", () => {
    const { commands } = parseCommands("/fast /smart hello");
    expect(commands.map((c) => c.name)).toEqual(["fast", "smart"]);
  });

  it("ignores unregistered /tokens and leaves them in the text", () => {
    const { commands, text } = parseCommands("/unknown do a thing /fake");
    expect(commands).toEqual([]);
    expect(text).toBe("/unknown do a thing /fake");
  });

  it("does not treat slashes inside words or paths as commands", () => {
    const { commands, text } = parseCommands("read docs/help/HELP.md and a/b/c");
    expect(commands).toEqual([]);
    expect(text).toBe("read docs/help/HELP.md and a/b/c");
  });

  it("returns empty text when the message is only a command", () => {
    expect(parseCommands("/help").text).toBe("");
  });
});
