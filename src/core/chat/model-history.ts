import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { InvalidRequestError } from "../errors";
import { parseCommands } from "./commands";
import type { ChatMessage } from "./contract";

// Filename-safe only, same rule as the display sessions store.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const storedSchema = z.object({
  userTurns: z.number().int().nonnegative(),
  messages: z.array(z.unknown()),
});

type StoredHistory = { userTurns: number; messages: ModelMessage[] };

// One JSON file per session under <sessions dir>/model/: the transcript the model actually
// saw, including tool calls and their outputs that the display transcript drops. Follows
// SPEKTER_SESSIONS_DIR by default so both stores move together.
function historyDir() {
  const configured = process.env.SPEKTER_MODEL_HISTORY_DIR?.trim();
  if (configured) return resolve(configured);
  return resolve(join(process.env.SPEKTER_SESSIONS_DIR?.trim() || "sessions", "model"));
}

// A missing, invalid, or malformed file reads as absent rather than failing — the
// conversation then rebuilds from the display transcript like it always has.
async function readHistory(id: string): Promise<StoredHistory | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(historyDir(), `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
  const result = storedSchema.safeParse(parsed);
  return result.success ? { userTurns: result.data.userTurns, messages: result.data.messages as ModelMessage[] } : null;
}

// Write-then-rename keeps a killed write from leaving a torn history file.
async function writeHistory(id: string, history: StoredHistory): Promise<void> {
  const dir = historyDir();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${id}.json.tmp`);
  await writeFile(tmp, JSON.stringify(history));
  await rename(tmp, join(dir, `${id}.json`));
}

// Providers ignore thinking blocks from earlier turns; keeping them only costs tokens.
function withoutReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") return [message];
    const content = message.content.filter((part) => part.type !== "reasoning");
    return content.length ? [{ ...message, content }] : [];
  });
}

// Display messages carry only user/assistant text; converting is a rename, not a lossy step.
function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message) =>
    message.role === "user"
      ? { role: "user", content: message.content }
      : { role: "assistant", content: message.content },
  );
}

const userText = (message: ModelMessage) => (typeof message.content === "string" ? message.content : "");

// History stores what the model saw — command tokens stripped — so comparisons strip too.
const commandStripped = (content: string) => parseCommands(content).text || content;

// Index in `prefix` just past the exchange belonging to its `count`-th user message.
function exchangeEnd(prefix: ChatMessage[], count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i].role === "user" && ++seen > count) return i;
  }
  return prefix.length;
}

// The stored transcript can only continue a display prefix whose first `userTurns` user
// messages it still matches; any later display-only exchange (a slash-command turn, a
// dropped failed reply) is appended verbatim so the model still sees it. Returns null on
// any divergence — a fork or edit — and the caller rebuilds from the display transcript.
function reconcile(stored: StoredHistory, prefix: ChatMessage[]): ModelMessage[] | null {
  const prefixUsers = prefix.filter((message) => message.role === "user");
  if (stored.userTurns > prefixUsers.length) return null;
  const storedUsers = stored.messages.filter((message) => message.role === "user").map(userText);
  for (let i = 0; i < stored.userTurns; i++) {
    if (storedUsers[i] !== commandStripped(prefixUsers[i].content)) return null;
  }
  return [...stored.messages, ...toModelMessages(prefix.slice(exchangeEnd(prefix, stored.userTurns)))];
}

export type ModelHistory = {
  // The turn's messages ready for the model call: prior transcript plus the new user message.
  messages: ModelMessage[];
  // Appends the turn to the stored transcript; a no-op when the turn produced nothing.
  commit(produced: ModelMessage[] | undefined): Promise<void>;
};

const stateless = (messages: ChatMessage[]): ModelHistory => ({
  messages: toModelMessages(messages),
  commit: async () => {},
});

// Opens the session's model transcript for this turn. `messages` is the resolved display
// conversation ending in the new user message; the returned history may carry tool calls
// and outputs from earlier turns that the display transcript never held.
export async function openModelHistory(sessionId: string | undefined, messages: ChatMessage[]): Promise<ModelHistory> {
  const last = messages.at(-1);
  if (!sessionId || !last) return stateless(messages);
  if (!SAFE_ID.test(sessionId)) throw new InvalidRequestError("Invalid session id");

  const prefix = messages.slice(0, -1);
  const stored = await readHistory(sessionId);
  const base = (stored && reconcile(stored, prefix)) ?? toModelMessages(prefix);

  const turn: ModelMessage = { role: "user", content: last.content };
  return {
    messages: [...base, turn],
    commit: async (produced) => {
      if (!produced?.length) return;
      const transcript = [...base, turn, ...withoutReasoning(produced)];
      const userTurns = transcript.filter((message) => message.role === "user").length;
      await writeHistory(sessionId, { userTurns, messages: transcript });
    },
  };
}
