import type { LanguageModel, ModelMessage } from "ai";
import { agentLoop } from "../agent";
import type { ToolOutcome } from "../agent/loop";
import type { SpekterError } from "../errors";
import {
  assembleChatCall,
  contextSources,
  incompleteReplyReason,
  loopOptions,
  toolSources,
  toProviderError,
  type ChatContext,
} from "./complete";
import type { ChatStreamFrame } from "./stream-frames";

function errorFrame({ code, message }: SpekterError): ChatStreamFrame {
  return { type: "error", code, message };
}

// Returns the messages the turn produced — its generator return value, so wire frames
// never carry them. Undefined on aborted, cancelled, or failed turns: nothing to keep.
export async function* streamChat(
  messages: ModelMessage[],
  model: LanguageModel,
  context: ChatContext = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<ChatStreamFrame, ModelMessage[] | undefined> {
  // External inputs are announced before the reply so interfaces can show what
  // went into it as it happens, not only after done.
  const sources = contextSources(context);
  if (sources.length > 0) yield { type: "sources", sources };

  const events = agentLoop.stream(assembleChatCall(messages, model, context), loopOptions(context, abortSignal));

  let text = "";
  const toolCalls: ToolOutcome[] = [];
  let produced: ModelMessage[] | undefined;
  // Only a cleanly finished turn gets persisted: produced messages without a done
  // frame mean the client never saw a complete reply.
  let done = false;
  try {
    for await (const event of events) {
      switch (event.type) {
        case "text":
          text += event.text;
          yield { type: "delta", text: event.text };
          break;
        case "reasoning":
          yield { type: "reasoning", text: event.text };
          break;
        case "tool_call":
          yield { type: "tool_call", id: event.id, name: event.name, input: event.input };
          break;
        case "tool_result": {
          const { id, name, ok } = event;
          toolCalls.push({ id, name, ok });
          yield { type: "tool_result", id, name, ok };
          break;
        }
        case "produced":
          produced = event.messages;
          break;
        case "error":
          if (abortSignal?.aborted) return;
          yield errorFrame(toProviderError(event.error, context.knowledge));
          return;
        case "abort":
          return;
        case "finish": {
          const problem = incompleteReplyReason(text, event.finishReason);
          if (problem) {
            yield { type: "error", code: "provider_error", message: problem };
            return;
          }
          yield {
            type: "done",
            model: typeof model === "string" ? model : model.modelId,
            sources: [...sources, ...toolSources(toolCalls)],
          };
          done = true;
          break;
        }
      }
    }
    return done ? produced : undefined;
  } catch (error) {
    if (abortSignal?.aborted) return;
    yield errorFrame(toProviderError(error, context.knowledge));
  }
}
