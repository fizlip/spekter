import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/components/chat/types";
import {
  buildSession,
  deriveTitle,
  normalizeTranscript,
  restoreMessages,
  shouldPersist,
  summarize,
} from "./session";

const at = (iso: string) => iso;

const user = (content: string, createdAt = at("2026-10-21T10:00:00Z")): ChatMessage => ({
  id: `u-${content.length}`,
  role: "user",
  content,
  createdAt,
});

const assistant = (content: string, status?: ChatMessage["status"]): ChatMessage => ({
  id: `a-${content.length}`,
  role: "assistant",
  content,
  createdAt: at("2026-10-21T10:01:00Z"),
  ...(status ? { status } : {}),
});

describe("buildSession", () => {
  it("produces the session envelope with metadata and normalized messages", () => {
    const session = buildSession({
      id: "abc-123",
      model: "openai/gpt-test",
      messages: [user("hello"), assistant("hi", "streaming")],
      createdAt: at("2026-10-21T09:59:00Z"),
      now: at("2026-10-21T10:02:00Z"),
    });

    expect(session).toMatchObject({
      id: "abc-123",
      title: "hello",
      model: "openai/gpt-test",
      createdAt: at("2026-10-21T09:59:00Z"),
      updatedAt: at("2026-10-21T10:02:00Z"),
    });
    expect(session.messages[1].status).toBe("error");
  });
});

describe("deriveTitle", () => {
  it("uses the first line of the first user message", () => {
    expect(deriveTitle([assistant("hi"), user("first line\nsecond line"), user("later")], new Date())).toBe(
      "first line",
    );
  });

  it("truncates long titles with an ellipsis", () => {
    const title = deriveTitle([user("x".repeat(120))], new Date());
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to a timestamp label when there is no user message", () => {
    expect(deriveTitle([assistant("hi")], new Date("2026-10-21T10:00:00Z"))).toBe("Session 2026-10-21");
  });
});

describe("normalizeTranscript", () => {
  it("marks streaming assistant and reasoning messages as interrupted", () => {
    const messages = normalizeTranscript([
      user("q"),
      { ...assistant("partial", "streaming"), id: "a1" },
      { id: "r1", role: "reasoning", content: "thinking", createdAt: at("2026-10-21T10:01:00Z"), status: "streaming" },
    ]);

    expect(messages[1]).toMatchObject({ status: "error", error: "Interrupted" });
    expect(messages[2]).toMatchObject({ status: "error", error: "Interrupted" });
  });

  it("leaves settled messages unchanged", () => {
    const messages = [user("q"), assistant("done")];
    expect(normalizeTranscript(messages)).toEqual(messages);
  });
});

describe("shouldPersist", () => {
  const dirty = { dirty: true, isThinking: false };

  it("is false on a mount with restored messages and no sent turn", () => {
    expect(shouldPersist({ ...dirty, dirty: false, messages: [user("q"), assistant("a")] })).toBe(false);
  });

  it("is false while a reply is still thinking", () => {
    expect(shouldPersist({ ...dirty, isThinking: true, messages: [user("q")] })).toBe(false);
  });

  it("is true after a sent turn settles", () => {
    expect(shouldPersist({ ...dirty, messages: [user("q"), assistant("a")] })).toBe(true);
  });

  it("is false when the transcript holds no user message", () => {
    expect(shouldPersist({ ...dirty, messages: [assistant("seed")] })).toBe(false);
  });
});

describe("restoreMessages", () => {
  it("returns the stored transcript verbatim, including display-only roles and interrupted state", () => {
    const session = buildSession({
      id: "s1",
      model: null,
      messages: [
        user("q"),
        { id: "r1", role: "reasoning", content: "thought", createdAt: at("2026-10-21T10:00:30Z") },
        { id: "t1", role: "tool", content: "", createdAt: at("2026-10-21T10:00:40Z"), tool: { id: "c1", name: "read_file", state: "succeeded" } },
        { ...assistant("answer") },
        { id: "src1", role: "source", content: "", createdAt: at("2026-10-21T10:01:10Z"), sources: [{ type: "tool", name: "read_file" }] },
      ],
      createdAt: at("2026-10-21T10:00:00Z"),
      now: at("2026-10-21T10:01:30Z"),
    });

    expect(restoreMessages(session)).toEqual(session.messages);
  });
});

describe("summarize", () => {
  it("drops the messages array and keeps the list fields", () => {
    const session = buildSession({
      id: "s1",
      model: "m",
      messages: [user("q"), assistant("a")],
      createdAt: at("2026-10-21T10:00:00Z"),
      now: at("2026-10-21T10:01:00Z"),
    });
    const summary = summarize(session);
    expect(summary).toEqual({
      id: "s1",
      title: "q",
      model: "m",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
    expect("messages" in summary).toBe(false);
  });
});
