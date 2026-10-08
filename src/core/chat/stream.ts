import { streamText, type LanguageModel } from "ai";
import type { SpekterError } from "../errors";
import { assembleChatCall, incompleteReplyReason, toProviderError } from "./complete";
import type { ChatMessage } from "./contract";
import type { ChatStreamFrame } from "./stream-frames";

function errorFrame({ code, message }: SpekterError): ChatStreamFrame {
  return { type: "error", code, message };
}

export async function* streamChat(
  messages: ChatMessage[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<ChatStreamFrame> {
  const result = streamText({
    ...assembleChatCall(messages, model),
    abortSignal,
    // Failures are reported to the caller as error frames below, not logged.
    onError: () => {},
  });

  let text = "";
  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          text += part.text;
          yield { type: "delta", text: part.text };
          break;
        case "reasoning-delta":
          yield { type: "reasoning", text: part.text };
          break;
        case "error":
          if (abortSignal?.aborted) return;
          yield errorFrame(toProviderError(part.error));
          return;
        case "abort":
          return;
        case "finish": {
          const problem = incompleteReplyReason(text, part.finishReason);
          yield problem
            ? { type: "error", code: "provider_error", message: problem }
            : { type: "done", model: typeof model === "string" ? model : model.modelId };
          return;
        }
      }
    }
  } catch (error) {
    if (abortSignal?.aborted) return;
    yield errorFrame(toProviderError(error));
  }
}
