import { generateText, type FinishReason, type LanguageModel, type ModelMessage, type SystemModelMessage } from "ai";
import { ProviderError } from "../errors";
import type { KnowledgeNote } from "../knowledge/markdown-folder";
import type { ChatMessage, Source } from "./contract";
import { needsReasoning } from "./reasoning";

const INCOMPLETE_FINISH_REASONS: ReadonlySet<FinishReason> = new Set(["content-filter", "error", "other"]);

// What the Core adds to the caller's conversation: instructions and knowledge.
export type ChatContext = {
  systemPrompt?: string | null;
  knowledge?: KnowledgeNote[];
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

// The one place both endpoints build the model call; system prompt, knowledge and tools attach here.
// Knowledge is its own system message so the prompt file and the notes change independently.
export function assembleChatCall(
  messages: ChatMessage[],
  model: LanguageModel,
  { systemPrompt, knowledge = [] }: ChatContext = {},
): {
  model: LanguageModel;
  system?: string | SystemModelMessage[];
  messages: ModelMessage[];
  providerOptions: {
    openrouter: { reasoning: { effort: "medium" | "none" } };
  };
} {
  const effort = needsReasoning(messages) ? ("medium" as const) : ("none" as const);
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

export function toProviderError(error: unknown): ProviderError {
  return new ProviderError(error instanceof Error ? error.message : String(error));
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
    throw toProviderError(error);
  }

  const { text, finishReason } = result;
  const problem = incompleteReplyReason(text, finishReason);
  if (problem) throw new ProviderError(problem);
  return { text, sources: knowledgeSources(context.knowledge) };
}
