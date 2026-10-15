import type { ChatMessage } from "@/core/chat/contract";

// The slice of a Discord message the history builder needs; tests and the
// dispatcher can both hand it real Message objects or plain fixtures.
export type ThreadMessage = {
  content: string;
  author: { id: string; bot: boolean };
};

// Remove `<@id>` / `<@!id>` mention markup for the bot from message text.
export function stripBotMention(content: string, botUserId: string): string {
  return content.replaceAll(`<@${botUserId}>`, "").replaceAll(`<@!${botUserId}>`, "");
}

// Rebuild a thread's visible history into the Core's { role, content } shape.
// Incoming messages arrive newest-first (Discord fetch order). Returns null
// when nothing usable remains.
export function buildThreadHistory(
  messagesNewestFirst: ThreadMessage[],
  opts: { allowedUserId: string; botUserId: string; historyLimit: number },
): ChatMessage[] | null {
  const mapped = [...messagesNewestFirst].reverse().flatMap((message): ChatMessage[] => {
    const role =
      message.author.id === opts.botUserId
        ? "assistant"
        : !message.author.bot && message.author.id === opts.allowedUserId
          ? "user"
          : null;
    if (!role) return [];
    const content = stripBotMention(message.content, opts.botUserId).trim();
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

  // The request must end with a user message; an assistant tail would mean the
  // bot already replied to the newest kept message.
  const bounded = merged.slice(-opts.historyLimit);
  while (bounded.at(-1)?.role === "assistant") bounded.pop();
  return bounded.length ? bounded : null;
}
