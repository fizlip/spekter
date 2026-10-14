import type { ChatMessage } from "@/core/chat/contract";

// The slice of a Discord message the history builder needs; tests and the
// dispatcher can both hand it real Message objects or plain fixtures.
export type ThreadMessage = {
  id: string;
  content: string;
  author: { id: string; bot: boolean };
};

// Rebuild a thread's visible history into the Core's { role, content } shape.
// Incoming messages arrive newest-first (Discord fetch order). Returns null
// when nothing usable remains.
export function buildThreadHistory(
  messagesNewestFirst: ThreadMessage[],
  botUserId: string,
  allowedUserId: string,
  limit: number,
): ChatMessage[] | null {
  const mentionPattern = new RegExp(`<@!?${botUserId}>`, "g");

  const mapped = [...messagesNewestFirst].reverse().flatMap((message): ChatMessage[] => {
    const role =
      message.author.id === botUserId
        ? "assistant"
        : !message.author.bot && message.author.id === allowedUserId
          ? "user"
          : null;
    if (!role) return [];
    const content = message.content.replace(mentionPattern, "").trim();
    return content ? [{ role, content }] : [];
  });

  const merged: ChatMessage[] = [];
  for (const message of mapped) {
    const last = merged.at(-1);
    if (last && last.role === message.role) {
      last.content += `\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }

  const bounded = merged.slice(-limit);
  while (bounded.at(-1)?.role === "assistant") bounded.pop();
  return bounded.length ? bounded : null;
}
