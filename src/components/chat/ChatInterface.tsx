"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import {
  AssistantMessage,
  formatDayLabel,
  getDayKey,
  UserMessage,
} from "./ChatMessageBubble";
import { streamReply, toConversation } from "./stream-client";
import type { ChatMessage } from "./types";
import { Plus } from "lucide-react";

export function ChatInterface({
  initialMessages,
  todayKey,
  model,
}: {
  initialMessages: ChatMessage[];
  todayKey: string;
  model: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const followBottomRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);

  function handleScroll() {
    const el = scrollRef.current;
    if (el) followBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [messages, isThinking]);

  useEffect(() => () => inFlightRef.current?.abort(), []);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isThinking) return;

    followBottomRef.current = true;
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content, createdAt: sentAt };
    const replyId = `assistant-${Date.now()}`;
    const updateReply = (change: (reply: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((current) =>
        current.map((message) => (message.id === replyId ? { ...message, ...change(message) } : message)),
      );

    setMessages((current) => [
      ...current,
      userMessage,
      { id: replyId, role: "assistant", content: "", createdAt: sentAt, status: "streaming" },
    ]);
    setDraft("");
    setIsThinking(true);

    const controller = new AbortController();
    inFlightRef.current = controller;
    await streamReply(
      toConversation([...messages, userMessage]),
      {
        onDelta: (text) => updateReply((reply) => ({ content: reply.content + text })),
        onReasoning: (text) => updateReply((reply) => ({ reasoning: (reply.reasoning ?? "") + text })),
        onDone: () => updateReply(() => ({ status: undefined })),
        onError: ({ message }) => updateReply(() => ({ status: "error", error: message })),
      },
      controller.signal,
    );
    inFlightRef.current = null;
    setIsThinking(false);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-chat shadow rounded-md">
      {messages.length === 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[url(/afry.png)] bg-[position:center_30%] bg-no-repeat bg-[length:33%_auto] [mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.05)_0%,rgb(0_0_0/0.025)_35%,rgb(0_0_0/0.008)_65%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.04)_0%,rgb(0_0_0/0.00)_50%,transparent_100%)]"
        />
      )}
      <button
        type="button"
        onClick={() => {
          inFlightRef.current?.abort();
          setMessages([]);
        }}
        className="flex items-center gap-2 self-start m-2 cursor-pointer rounded-full px-2 py-1 text-sm text-black hover:bg-gray-100"
      >
        <Plus size={14}/>
        New session
      </button>
      <section
        ref={scrollRef}
        onScroll={handleScroll}
        aria-label="Conversation"
        aria-live="polite"
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth py-6 sm:py-8"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center gap-8">
            <div className="w-full">
              <ChatComposer
                onChange={setDraft}
                onSend={sendMessage}
                value={draft}
                model={model}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-3/4 flex-col gap-2">
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
          </div>
        )}
      </section>

      {messages.length > 0 && (
        <footer className="relative shrink-0 bg-transparent p-2">
          <div className="w-3/4 m-auto">
            <ChatComposer
              onChange={setDraft}
              onSend={sendMessage}
              value={draft}
              model={model}
            />
          </div>
        </footer>
      )}
    </div>
  );
}
