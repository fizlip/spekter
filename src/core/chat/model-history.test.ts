import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./contract";
import { openModelHistory } from "./model-history";

// The store resolves through SPEKTER_MODEL_HISTORY_DIR, pointed at a temp dir per test.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-model-history-"));
  vi.stubEnv("SPEKTER_MODEL_HISTORY_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const user = (content: string): ChatMessage => ({ role: "user", content });
const assistant = (content: string): ChatMessage => ({ role: "assistant", content });

// What a tool-using turn's response.messages look like, in AI SDK shape.
const toolTurn: ModelMessage[] = [
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-1", toolName: "current_time", input: {} }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "current_time",
        output: { type: "json", value: { now: "2026-10-12T11:18:00Z" } },
      },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "It is Monday." }] },
];

async function stored(id: string): Promise<{ userTurns: number; messages: ModelMessage[] }> {
  return JSON.parse(await readFile(join(dir, `${id}.json`), "utf-8"));
}

describe("openModelHistory", () => {
  it("runs stateless without a session id: display messages in, no file written", async () => {
    const history = await openModelHistory(undefined, [user("hi"), assistant("hello"), user("again")]);

    expect(history.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
    await history.commit(toolTurn);
    await expect(readFile(join(dir, "anything.json"), "utf-8")).rejects.toThrow();
  });

  it("rejects a session id that could escape the store", async () => {
    await expect(openModelHistory("../x", [user("hi")])).rejects.toThrow("Invalid session id");
  });

  it("stores the turn's tool calls and results on commit", async () => {
    const history = await openModelHistory("s1", [user("what day?")]);
    await history.commit(toolTurn);

    const file = await stored("s1");
    expect(file.userTurns).toBe(1);
    expect(file.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  it("carries prior tool calls and results into the next turn", async () => {
    const first = await openModelHistory("s1", [user("what day?")]);
    await first.commit(toolTurn);

    const second = await openModelHistory("s1", [
      user("what day?"),
      assistant("It is Monday."),
      user("and tomorrow?"),
    ]);

    // The model transcript, not the display one: the tool messages are back.
    expect(second.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(second.messages)).toContain('"tool-result"');
    expect(second.messages.at(-1)).toEqual({ role: "user", content: "and tomorrow?" });
  });

  it("rebuilds from the display transcript when the stored history diverged", async () => {
    const first = await openModelHistory("s1", [user("what day?")]);
    await first.commit(toolTurn);

    // A forked or edited conversation no longer matches the stored user turns.
    const forked = await openModelHistory("s1", [user("different question"), assistant("..."), user("next")]);

    expect(forked.messages).toEqual([
      { role: "user", content: "different question" },
      { role: "assistant", content: "..." },
      { role: "user", content: "next" },
    ]);
  });

  it("keeps stored history when a display-only exchange sits between stored turns", async () => {
    const first = await openModelHistory("s1", [user("what day?")]);
    await first.commit(toolTurn);

    // A slash-command turn never reached the model, so history lacks it — but the
    // model still needs to see it happened. Stored tool parts survive the join.
    const history = await openModelHistory("s1", [
      user("what day?"),
      assistant("It is Monday."),
      user("/recap"),
      assistant("You asked about the day."),
      user("and tomorrow?"),
    ]);

    expect(history.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(history.messages)).toContain('"tool-result"');
    expect(history.messages.at(-1)).toEqual({ role: "user", content: "and tomorrow?" });
  });

  it("matches a stored user turn against the raw text with command tokens", async () => {
    const first = await openModelHistory("s1", [user("what day?")]);
    await first.commit(toolTurn);

    // The display transcript keeps "/fast" as typed; history stored what the model saw.
    const history = await openModelHistory("s1", [
      user("what day? /fast"),
      assistant("It is Monday."),
      user("and tomorrow?"),
    ]);

    expect(history.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
  });

  it("strips reasoning parts when committing", async () => {
    const history = await openModelHistory("s1", [user("hi")]);
    await history.commit([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "hmm" },
          { type: "text", text: "hello" },
        ],
      },
    ]);

    const file = await stored("s1");
    expect(file.messages.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("ignores a malformed history file and rebuilds from the display transcript", async () => {
    await writeFile(join(dir, "s1.json"), "not json{");

    const history = await openModelHistory("s1", [user("a"), assistant("b"), user("c")]);

    expect(history.messages).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
  });

  it("writes nothing when a turn produced no messages", async () => {
    const history = await openModelHistory("s1", [user("hi")]);
    await history.commit(undefined);

    await expect(stored("s1")).rejects.toThrow();
  });
});
