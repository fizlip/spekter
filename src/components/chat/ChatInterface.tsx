"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import {
  AssistantMessage,
  formatDayLabel,
  getDayKey,
  ReasoningMessage,
  SourceMessage,
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
    const reasoningId = `reasoning-${Date.now()}`;
    const replyId = `assistant-${Date.now()}`;
    const updateReply = (change: (reply: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((current) =>
        current.map((message) => (message.id === replyId ? { ...message, ...change(message) } : message)),
      );

    // Reasoning is its own message that appears above the reply on the first reasoning
    // frame, then closes when reply text, an error, or done ends the thinking phase.
    let reasoningFinished = false;
    const finishReasoning = () => {
      if (reasoningFinished) return;
      reasoningFinished = true;
      setMessages((current) =>
        current.map((message) =>
          message.id === reasoningId ? { ...message, status: undefined } : message,
        ),
      );
    };
    // Messages that belong to the pending reply — reasoning and sources — land
    // between the user message and the reply placeholder.
    const insertBeforeReply = (current: ChatMessage[], message: ChatMessage) => {
      const next = [...current];
      const replyIndex = next.findIndex((m) => m.id === replyId);
      next.splice(replyIndex === -1 ? next.length : replyIndex, 0, message);
      return next;
    };
    const appendReasoning = (text: string) =>
      setMessages((current) => {
        if (current.some((message) => message.id === reasoningId)) {
          return current.map((message) =>
            message.id === reasoningId ? { ...message, content: message.content + text } : message,
          );
        }
        return insertBeforeReply(current, {
          id: reasoningId,
          role: "reasoning",
          content: text,
          createdAt: new Date().toISOString(),
          status: "streaming",
        });
      });

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
        onDelta: (text) => {
          finishReasoning();
          updateReply((reply) => ({ content: reply.content + text }));
        },
        onReasoning: appendReasoning,
        onSources: (sources) => {
          if (sources.length === 0) return;
          setMessages((current) =>
            insertBeforeReply(current, {
              id: `source-${Date.now()}`,
              role: "source",
              content: "",
              createdAt: new Date().toISOString(),
              sources,
            }),
          );
        },
        onDone: () => {
          finishReasoning();
          updateReply(() => ({ status: undefined }));
        },
        onError: ({ message }) => {
          finishReasoning();
          updateReply(() => ({ status: "error", error: message }));
        },
      },
      controller.signal,
    );
    inFlightRef.current = null;
    setIsThinking(false);
  }

  const lastAssistantIndex = messages.findLastIndex((m) => m.role === "assistant");

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

              // While reasoning streams, the pending reply stays hidden so only the
              // trace shows; it appears with the first text delta, when reasoning ends.
              if (message.role === "assistant" && message.status === "streaming" && !message.content &&
                  messages.some((m) => m.role === "reasoning" && m.status === "streaming")) {
                return null;
              }

              return (
                <div className="contents" key={message.id}>
                  {message.role === "assistant" ? (
                    <AssistantMessage message={message} showAvatar={index === lastAssistantIndex} />
                  ) : message.role === "reasoning" ? (
                    <ReasoningMessage message={message} />
                  ) : message.role === "source" ? (
                    <SourceMessage message={message} />
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
