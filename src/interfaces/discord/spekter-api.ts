import type { ChatMessage, ChatResponse } from "@/core/chat/contract";

export const UNREACHABLE_MESSAGE = "Couldn't reach Spekter — is `npm run dev` running?";
export const TIMEOUT_MESSAGE = "Spekter took too long to answer.";
const REQUEST_TIMEOUT_MS = 300_000;

// One POST to the local chat API; failures return the message the thread
// should see, so the caller never has to distinguish reply from error.
export async function askSpekter(apiUrl: string, messages: ChatMessage[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      // The tool loop can run for minutes; a timeout still beats a queue wedged forever.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError" ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE;
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
