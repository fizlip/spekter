import type { ChatMessage as CoreChatMessage, Source } from "@/core/chat/contract";
import type { ChatStreamFrame } from "@/core/chat/stream-frames";
import type { ChatMessage } from "./types";

export type StreamError = { code: string; message: string };

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onReasoning: (text: string) => void;
  onSources?: (sources: Source[]) => void;
  onDone: (model: string) => void;
  onError: (error: StreamError) => void;
};

// Only completed exchanges go back to the model: a failed reply and the user
// message it answered are left out, so the conversation still reads naturally.
// Reasoning and source messages are display-only and never sent back.
export function toConversation(messages: ChatMessage[]): CoreChatMessage[] {
  const isExchangeMessage = (message: ChatMessage) =>
    message.role === "user" || message.role === "assistant";
  return messages
    .filter(
      (message, index): message is ChatMessage & { role: "user" | "assistant" } =>
        isExchangeMessage(message) &&
        !message.status &&
        messages.slice(index + 1).find(isExchangeMessage)?.status !== "error",
    )
    .map(({ role, content }) => ({ role, content }));
}

export async function streamReply(
  messages: CoreChatMessage[],
  { onDelta, onReasoning, onSources, onDone, onError }: StreamHandlers,
  signal?: AbortSignal,
  model?: string,
): Promise<void> {
  const networkError = (error: unknown) => {
    if (!signal?.aborted) onError({ code: "network_error", message: errorMessage(error) });
  };

  let response: Response;
  try {
    response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, ...(model ? { model } : {}) }),
      signal,
    });
  } catch (error) {
    return networkError(error);
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => undefined);
    return onError(body?.error ?? { code: "http_error", message: `Request failed with status ${response.status}` });
  }

  try {
    for await (const frame of readFrames(response.body)) {
      if (frame.type === "delta") onDelta(frame.text);
      else if (frame.type === "reasoning") onReasoning(frame.text);
      else if (frame.type === "sources") onSources?.(frame.sources);
      else if (frame.type === "done") return onDone(frame.model);
      else return onError({ code: frame.code, message: frame.message });
    }
  } catch (error) {
    return networkError(error);
  }
  networkError(new Error("The reply stream ended unexpectedly"));
}

async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as ChatStreamFrame;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function errorMessage(error: unknown) {
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
