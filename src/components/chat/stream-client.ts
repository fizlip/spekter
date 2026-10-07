import type { ChatMessage as CoreChatMessage } from "@/core/chat/contract";
import type { ChatStreamFrame } from "@/core/chat/stream-frames";
import type { ChatMessage } from "./types";

export type StreamError = { code: string; message: string };

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: (model: string) => void;
  onError: (error: StreamError) => void;
};

// Only completed exchanges go back to the model: a failed reply and the user
// message it answered are left out, so the conversation still reads naturally.
export function toConversation(messages: ChatMessage[]): CoreChatMessage[] {
  return messages
    .filter((message, index) => !message.status && messages[index + 1]?.status !== "error")
    .map(({ role, content }) => ({ role, content }));
}

export async function streamReply(
  messages: CoreChatMessage[],
  { onDelta, onDone, onError }: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const networkError = (error: unknown) => {
    if (!signal?.aborted) onError({ code: "network_error", message: errorMessage(error) });
  };

  let response: Response;
  try {
    response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
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
  return error instanceof Error ? error.message : String(error);
}
