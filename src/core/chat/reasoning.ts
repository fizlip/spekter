import type { ChatMessage } from "./contract";

export function needsReasoning(messages: ChatMessage[]): boolean {
  const last = messages.at(-1)?.content ?? "";
  return last.length > 10;
}