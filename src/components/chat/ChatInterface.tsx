"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import {
  AssistantMessage,
  formatDayLabel,
  getDayKey,
  ReasoningMessage,
  SourceMessage,
  ToolMessage,
  UserMessage,
} from "./ChatMessageBubble";
import { streamReply, toConversation } from "./stream-client";
import { buildSession, shouldPersist } from "@/interfaces/web/session";
import { putSession } from "@/interfaces/web/session-client";
import type { ChatMessage } from "./types";
import { Plus } from "lucide-react";

export function ChatInterface({
  initialMessages,
  todayKey,
  model,
  sessionId,
  onNewSession,
  onSessionSaved,
}: {
  initialMessages: ChatMessage[];
  todayKey: string;
  model: string | null;
  sessionId: string;
  onNewSession: () => void;
  onSessionSaved: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const followBottomRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);
  // Persisted once a turn is actually sent from this mount; restored or seeded
  // transcripts do not re-save until the user continues them.
  const dirtyRef = useRef(false);
  const createdAtRef = useRef<string | null>(null);

  function handleScroll() {
    const el = scrollRef.current;
    if (el) followBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [messages, isThinking]);

  useEffect(() => () => inFlightRef.current?.abort(), []);

  // The dropdown lists every model OpenRouter offers; a pick applies per request
  // until changed, falling back to the configured model.
  useEffect(() => {
    fetch("/api/models")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body && setModels(body.models ?? []))
      .catch(() => {});
  }, []);

  const activeModel = selectedModel ?? model;

  // Save on settle, not per frame: done, error, and abort all land here once the
  // reply stops streaming. Fire-and-forget — a failed save logs and retries on
  // the next settle rather than blocking the composer.
  useEffect(() => {
    if (!shouldPersist({ dirty: dirtyRef.current, isThinking, messages })) return;
    const now = new Date().toISOString();
    createdAtRef.current ??= now;
    putSession(
      buildSession({ id: sessionId, model: activeModel ?? null, messages, createdAt: createdAtRef.current, now }),
    )
      .then(onSessionSaved)
      .catch((error) => console.error("Failed to save session", error));
  }, [messages, isThinking, sessionId, activeModel, onSessionSaved]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isThinking) return;
    dirtyRef.current = true;
    followBottomRef.current = true;
    const sentAt = new Date().toISOString();
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content, createdAt: sentAt };
    // Each reasoning segment between other events gets its own message, so the
    // transcript reads reasoning > tool call > reasoning > tool call, in order.
    let reasoningId = `reasoning-${Date.now()}`;
    let reasoningCount = 0;
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
    // A reasoning frame after reasoning was closed starts a new segment, not a
    // reopening of the old message: reasoning between tool calls stays in order.
    const openReasoning = () => {
      if (!reasoningFinished) return;
      reasoningFinished = false;
      reasoningId = `reasoning-${Date.now()}-${reasoningCount++}`;
    };
    // Messages that belong to the pending reply — reasoning, sources, and tool calls — land
    // between the user message and the reply placeholder.
    const insertBeforeReply = (current: ChatMessage[], message: ChatMessage) => {
      const next = [...current];
      const replyIndex = next.findIndex((m) => m.id === replyId);
      next.splice(replyIndex === -1 ? next.length : replyIndex, 0, message);
      return next;
    };
    const appendReasoning = (text: string) => {
      openReasoning();
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
    };

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
        onToolCall: ({ id, name, input }) => {
          finishReasoning();
          const path =
            input && typeof input === "object" && "path" in input && typeof input.path === "string"
              ? input.path
              : undefined;
          setMessages((current) =>
            insertBeforeReply(current, {
              id: `tool-${id}`,
              role: "tool",
              content: "",
              createdAt: new Date().toISOString(),
              tool: { id, name, state: "running", ...(path ? { path } : {}) },
            }),
          );
        },
        onToolResult: ({ id, name, ok }) =>
          setMessages((current) =>
            current.map((message) =>
              message.id === `tool-${id}`
                ? { ...message, tool: { ...message.tool!, id, name, state: ok ? "succeeded" : "failed" } }
                : message,
            ),
          ),
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
      activeModel ?? undefined,
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
          onNewSession();
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
                model={activeModel}
                models={models}
                onSelectModel={setSelectedModel}
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
                  ) : message.role === "tool" ? (
                    <ToolMessage message={message} />
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
              model={activeModel}
              models={models}
              onSelectModel={setSelectedModel}
            />
          </div>
        </footer>
      )}
    </div>
  );
}
