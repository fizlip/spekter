import type { ChatMessage, ChatResponse } from "@/core/chat/contract";

export const UNREACHABLE_MESSAGE = "Couldn't reach Spekter — is `npm run dev` running?";

// One POST to the local chat API; failures return the message the thread
// should see, so the caller never has to distinguish reply from error (KTD7).
export async function askSpekter(apiUrl: string, messages: ChatMessage[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    return UNREACHABLE_MESSAGE;
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { code?: string; message?: string } }).error
        : undefined;
    if (error?.code && error.message) {
      return `Spekter error (${error.code}): ${error.message}`;
    }
    return `Spekter error: HTTP ${response.status}`;
  }

  const data = (await response.json()) as ChatResponse;
  return data.message.content;
}
