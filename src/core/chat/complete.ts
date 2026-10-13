import { generateText, type FinishReason, type LanguageModel, type SystemModelMessage } from "ai";
import type { ModelCall } from "../agent/loop";
import { ProviderError } from "../errors";
import type { KnowledgeNote } from "../knowledge/markdown-folder";
import type { ChatMessage, Source } from "./contract";
import { needsReasoning } from "./reasoning";

const INCOMPLETE_FINISH_REASONS: ReadonlySet<FinishReason> = new Set(["content-filter", "error", "other"]);

// What the Core adds to the caller's conversation: instructions and knowledge.
export type ChatContext = {
  systemPrompt?: string | null;
  knowledge?: KnowledgeNote[];
  // Explicit reasoning effort, e.g. from a slash command; wins over the heuristic.
  effort?: "medium" | "none";
  // Other external inputs that went into the reply (system prompt, command files).
  sources?: Source[];
};

function knowledgeMessage(notes: KnowledgeNote[]): SystemModelMessage {
  const blocks = notes.map(({ path, content }) => `<note path="${path}">\n${content}\n</note>`);
  return {
    role: "system",
    content: ["Knowledge notes. Each note starts with its path in the notes folder.", ...blocks].join("\n\n"),
  };
}

export function knowledgeSources(notes: KnowledgeNote[] = []): Source[] {
  return notes.map(({ path }) => ({ type: "knowledge_file", path }));
}

// Everything external that went into the reply: knowledge notes plus any
// extra sources the caller recorded (system prompt file, command files).
export function contextSources({ knowledge = [], sources = [] }: ChatContext): Source[] {
  return [...knowledgeSources(knowledge), ...sources];
}

// The one place both endpoints build the model call; system prompt, knowledge and tools attach here.
// Knowledge is its own system message so the prompt file and the notes change independently.
export function assembleChatCall(
  messages: ChatMessage[],
  model: LanguageModel,
  { systemPrompt, knowledge = [], effort: effortOverride }: ChatContext = {},
): ModelCall {
  const effort = effortOverride ?? (needsReasoning(messages) ? ("medium" as const) : ("none" as const));
  const system = knowledge.length
    ? [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        knowledgeMessage(knowledge),
      ]
    : (systemPrompt ?? undefined);
  return {
    model,
    system,
    messages,
    providerOptions: { openrouter: { reasoning: { effort } } },
  };
}

export function incompleteReplyReason(text: string, finishReason: FinishReason): string | undefined {
  if (INCOMPLETE_FINISH_REASONS.has(finishReason)) {
    return `Model stopped without completing its reply (finish reason: ${finishReason})`;
  }
  if (!text.trim()) return `Model returned no text (finish reason: ${finishReason})`;
}

const CONTEXT_OVERFLOW = /context length|context window|prompt is too long/i;

// Providers don't always fail with Error instances; plain-object payloads carry
// their detail in .message or need JSON, not "[object Object]".
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Rewrites a provider's context-overflow failure into a message saying what was too large;
// any other failure keeps the provider's message as is.
export function toProviderError(error: unknown, knowledge: KnowledgeNote[] = []): ProviderError {
  const message = errorMessage(error);
  if (!CONTEXT_OVERFLOW.test(message)) return new ProviderError(message);

  const bytes = knowledge.reduce((total, note) => total + Buffer.byteLength(note.content), 0);
  const subject = knowledge.length
    ? `The conversation and ${knowledge.length} knowledge ${knowledge.length === 1 ? "note" : "notes"} (${(bytes / 1024).toFixed(1)} KB, from SPEKTER_KNOWLEDGE_DIR) exceed`
    : "The conversation exceeds";
  return new ProviderError(`${subject} the model's context limit. Provider said: ${message}`);
}

export async function completeChat(
  messages: ChatMessage[],
  model: LanguageModel,
  context: ChatContext = {},
): Promise<{ text: string; sources: Source[] }> {
  let result;
  try {
    result = await generateText(assembleChatCall(messages, model, context));
  } catch (error) {
    throw toProviderError(error, context.knowledge);
  }

  const { text, finishReason } = result;
  const problem = incompleteReplyReason(text, finishReason);
  if (problem) throw new ProviderError(problem);
  return { text, sources: contextSources(context) };
}
