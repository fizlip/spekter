import { describe, expect, it } from "vitest";
import { DISCORD_MESSAGE_LIMIT, splitForDiscord } from "./format";

describe("splitForDiscord", () => {
  it("returns a short reply as one chunk", () => {
    expect(splitForDiscord("hello")).toEqual(["hello"]);
  });

  it("never produces empty output", () => {
    expect(splitForDiscord("")).toEqual(["(empty reply)"]);
  });

  it("keeps every chunk within the Discord limit", () => {
    const text = "word ".repeat(2000).trim(); // ~10k chars, spaces every 5
    const chunks = splitForDiscord(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("prefers a paragraph boundary over a mid-word cut", () => {
    const first = "a".repeat(1500);
    const second = "b".repeat(1500);
    const chunks = splitForDiscord(`${first}\n\n${second}`);

    expect(chunks[0]).toBe(first);
    expect(chunks[1]).toBe(second);
  });

  it("splits a plain newline boundary when no paragraph fits", () => {
    const first = "a".repeat(1500);
    const second = "b".repeat(1500);
    const chunks = splitForDiscord(`${first}\n${second}`);

    expect(chunks[0]).toBe(first);
    expect(chunks[1]).toBe(second);
  });

  it("hard-splits an unbroken over-limit block", () => {
    const text = "x".repeat(5000);
    const chunks = splitForDiscord(text);

    expect(chunks.map((c) => c.length)).toEqual([2000, 2000, 1000]);
    expect(chunks.join("")).toBe(text);
  });

  it("prefers the last word boundary inside the limit", () => {
    const first = "a".repeat(1990);
    const chunks = splitForDiscord(`${first} tail ${"z".repeat(100)}`);

    expect(chunks[0]).toBe(`${first} tail`);
    expect(chunks[0].length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });
});
