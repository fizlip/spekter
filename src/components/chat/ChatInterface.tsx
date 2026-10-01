"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import {
  AssistantMessage,
  formatDayLabel,
  getDayKey,
  UserMessage,
} from "./ChatMessageBubble";
import type { ChatMessage } from "./types";

export function ChatInterface({
  initialMessages,
  todayKey,
}: {
  initialMessages: ChatMessage[];
  todayKey: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking]);

  function sendMessage() {
    const content = draft.trim();
    if (!content || isThinking) return;

    const sentAt = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content, createdAt: sentAt },
    ]);
    setDraft("");
    setIsThinking(true);

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content:
            "This chat is ready for an AI provider. Connect your model in the chat handler to get a personalized response.",
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsThinking(false);
    }, 700);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <section
        aria-label="Conversation"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth py-6 sm:py-8"
      >
        <div className="flex w-full flex-col gap-2">
          {messages.map((message, index) => {
            const dayKey = getDayKey(message.createdAt);
            const startsDay = index === 0 || getDayKey(messages[index - 1].createdAt) !== dayKey;

            return (
              <div className="contents" key={message.id}>
                {startsDay && (
                  <div className="flex items-center gap-4 py-2" role="separator">
                    <span className="h-px flex-1 bg-slate-200/80" />
                    <span className="text-[11px] font-medium tracking-wide text-slate-400">
                      {formatDayLabel(dayKey, todayKey)}
                    </span>
                    <span className="h-px flex-1 bg-slate-200/80" />
                  </div>
                )}
                {message.role === "assistant" ? (
                  <AssistantMessage message={message} />
                ) : (
                  <UserMessage message={message} />
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </section>

      <footer className="shrink-0 bg-transparent px-4 pb-4 pt-3 sm:px-8 sm:pb-5">
        <div className="w-full">
          <ChatComposer
            disabled={isThinking}
            onChange={setDraft}
            onSend={sendMessage}
            value={draft}
          />
        </div>
      </footer>
    </div>
  );
}
