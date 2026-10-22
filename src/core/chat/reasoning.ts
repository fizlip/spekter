import type { ModelMessage } from "ai";

export function needsReasoning(messages: ModelMessage[]): boolean {
  const last = messages.at(-1)?.content;
  return typeof last === "string" && last.length > 10;
}
