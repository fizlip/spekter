import { describe, expect, it } from "vitest";
import { decideAction } from "./bot";

const base = {
  isBot: false,
  isAllowed: true,
  isThread: false,
  isMember: false,
  mentionsBot: false,
};

describe("decideAction", () => {
  it("spawns a thread when the allowed user mentions the bot in a channel", () => {
    expect(decideAction({ ...base, mentionsBot: true })).toBe("spawn");
  });

  it("ignores a channel message without a mention", () => {
    expect(decideAction(base)).toBe("ignore");
  });

  it("handles a message in a thread the bot has joined", () => {
    expect(decideAction({ ...base, isThread: true, isMember: true })).toBe("handle");
  });

  it("joins a foreign thread when the bot is mentioned inside it", () => {
    expect(decideAction({ ...base, isThread: true, mentionsBot: true })).toBe("join");
  });

  it("ignores a foreign thread message without a mention", () => {
    expect(decideAction({ ...base, isThread: true })).toBe("ignore");
  });

  it("ignores bot authors even when they mention the bot", () => {
    expect(decideAction({ ...base, isBot: true, mentionsBot: true })).toBe("ignore");
  });

  it("ignores other users everywhere, mention or not", () => {
    expect(decideAction({ ...base, isAllowed: false, mentionsBot: true })).toBe("ignore");
    expect(decideAction({ ...base, isAllowed: false, isThread: true, isMember: true })).toBe("ignore");
  });
});
