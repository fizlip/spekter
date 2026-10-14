import { describe, expect, it } from "vitest";
import { buildThreadHistory, type ThreadMessage } from "./history";

const BOT = "999";
const ME = "111";

function msg(content: string, authorId: string, bot = false): ThreadMessage {
  return { content, author: { id: authorId, bot: bot || authorId === BOT } };
}

function build(newestFirst: ThreadMessage[], historyLimit = 50) {
  return buildThreadHistory(newestFirst, { allowedUserId: ME, botUserId: BOT, historyLimit });
}

describe("buildThreadHistory", () => {
  it("orders messages oldest-first and maps mine to user, the bot's to assistant", () => {
    const newestFirst = [
      msg("follow-up", ME),
      msg("reply", BOT),
      msg("question", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "follow-up" },
    ]);
  });

  it("strips the bot mention markup from the seed message", () => {
    expect(build([msg(`hey <@${BOT}> what is up <@!${BOT}>`, ME)])).toEqual([
      { role: "user", content: "hey  what is up" },
    ]);
  });

  it("drops other users' and other bots' messages", () => {
    const newestFirst = [
      msg("mine", ME),
      msg("intruder", "555"),
      msg("otherbot", "777", true),
      msg("earlier", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "earlier\n\nmine" },
    ]);
  });

  it("merges consecutive same-role turns into one message", () => {
    const newestFirst = [
      msg("third", ME),
      msg("second", ME),
      msg("first", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "first\n\nsecond\n\nthird" },
    ]);
  });

  it("alternates cleanly across a real back-and-forth", () => {
    const newestFirst = [
      msg("q3", ME),
      msg("a2", BOT),
      msg("q2", ME),
      msg("a1", BOT),
      msg("q1", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
    ]);
  });

  it("drops messages that are empty after stripping, such as attachment-only posts", () => {
    const newestFirst = [
      msg("real question", ME),
      msg(`<@${BOT}>`, ME),
      msg("earlier", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "earlier\n\nreal question" },
    ]);
  });

  it("keeps only the most recent messages when over the limit", () => {
    const newestFirst = [
      msg("five", ME),
      msg("four", BOT),
      msg("three", ME),
      msg("two", BOT),
      msg("one", ME),
    ];
    expect(build(newestFirst, 4)).toEqual([
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
      { role: "assistant", content: "four" },
      { role: "user", content: "five" },
    ]);
  });

  it("trims a trailing assistant turn so the request still ends with a user message", () => {
    const newestFirst = [
      msg("bot reply", BOT),
      msg("my message", ME),
    ];
    expect(build(newestFirst)).toEqual([
      { role: "user", content: "my message" },
    ]);
  });

  it("returns null when nothing usable remains", () => {
    expect(build([])).toBeNull();
    expect(build([msg(`<@${BOT}>`, ME)])).toBeNull();
    expect(build([msg("someone else", "555")])).toBeNull();
  });
});
