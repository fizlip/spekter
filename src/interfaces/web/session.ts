import { z } from "zod";
import type { ChatMessage } from "@/components/chat/types";

const TITLE_MAX = 60;
const INTERRUPTED = "Interrupted";

const sourceSchema = z.union([
  z.object({ type: z.literal("command_file"), path: z.string() }),
  z.object({ type: z.literal("knowledge_file"), path: z.string() }),
  z.object({ type: z.literal("tool"), name: z.string() }),
]);

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "reasoning", "source", "tool"]),
  content: z.string(),
  createdAt: z.string(),
  status: z.enum(["streaming", "error"]).optional(),
  error: z.string().optional(),
  sources: z.array(sourceSchema).optional(),
  tool: z
    .object({
      id: z.string(),
      name: z.string(),
      state: z.enum(["running", "succeeded", "failed"]),
      path: z.string().optional(),
      cmd: z.string().optional(),
    })
    .optional(),
});

// One JSON file per session under sessions/: the full client transcript plus the
// metadata the sidebar list needs without opening the file's messages.
export const sessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  model: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(chatMessageSchema),
});

export type StoredSession = z.infer<typeof sessionSchema>;
export type SessionSummary = Omit<StoredSession, "messages">;

export function deriveTitle(messages: ChatMessage[], now: Date): string {
  const firstLine = messages.find((message) => message.role === "user")?.content.split("\n")[0].trim();
  if (!firstLine) return `Session ${now.toISOString().slice(0, 10)}`;
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
}

// A turn persisted mid-flight would otherwise restore with a live streaming
// shimmer; interrupted content reads as unfinished instead.
export function normalizeTranscript(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.status === "streaming" ? { ...message, status: "error" as const, error: INTERRUPTED } : message,
  );
}

export function buildSession(input: {
  id: string;
  model: string | null;
  messages: ChatMessage[];
  createdAt?: string;
  now: string;
}): StoredSession {
  return {
    id: input.id,
    title: deriveTitle(input.messages, new Date(input.now)),
    model: input.model,
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
    messages: normalizeTranscript(input.messages),
  };
}

// Restored messages go back verbatim — normalization already ran at save time.
export function restoreMessages(session: StoredSession): ChatMessage[] {
  return session.messages;
}

export function summarize(session: StoredSession): SessionSummary {
  const { messages: _messages, ...summary } = session;
  return summary;
}

// Persist only after a turn was actually sent from this mount: restored or
// seeded transcripts do not re-save until the user continues them.
export function shouldPersist(input: {
  dirty: boolean;
  isThinking: boolean;
  messages: ChatMessage[];
}): boolean {
  return input.dirty && !input.isThinking && input.messages.some((message) => message.role === "user");
}
