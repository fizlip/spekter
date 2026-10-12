import { streamText, type LanguageModel } from "ai";
import type { SpekterError } from "../errors";
import { assembleChatCall, incompleteReplyReason, knowledgeSources, toProviderError, type ChatContext } from "./complete";
import type { ChatMessage } from "./contract";
import type { ChatStreamFrame } from "./stream-frames";

function errorFrame({ code, message }: SpekterError): ChatStreamFrame {
  return { type: "error", code, message };
}

export async function* streamChat(
  messages: ChatMessage[],
  model: LanguageModel,
  context: ChatContext = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<ChatStreamFrame> {
  // External inputs are announced before the reply so interfaces can show what
  // went into it as it happens, not only after done.
  const sources = knowledgeSources(context.knowledge);
  if (sources.length > 0) yield { type: "sources", sources };

  const result = streamText({
    ...assembleChatCall(messages, model, context),
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
          yield errorFrame(toProviderError(part.error, context.knowledge));
          return;
        case "abort":
          return;
        case "finish": {
          const problem = incompleteReplyReason(text, part.finishReason);
          yield problem
            ? { type: "error", code: "provider_error", message: problem }
            : {
                type: "done",
                model: typeof model === "string" ? model : model.modelId,
                sources,
              };
          return;
        }
      }
    }
  } catch (error) {
    if (abortSignal?.aborted) return;
    yield errorFrame(toProviderError(error, context.knowledge));
  }
}
