import { commandReplyFrames, resolveCommands } from "@/core/chat/commands";
import { openModelHistory } from "@/core/chat/model-history";
import { streamChat } from "@/core/chat/stream";
import { serializeFrame, STREAM_CONTENT_TYPE, type ChatStreamFrame } from "@/core/chat/stream-frames";
import { readSystemPrompt } from "@/core/chat/system-prompt";
import { readConfig, readMaxSteps } from "@/core/config";
import { trackRequest, trackStream } from "@/core/instrumentation/request-log";
import { readKnowledge } from "@/core/knowledge/markdown-folder";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { builtinTools } from "@/core/tools/registry";
import { errorResponse, readChatRequest } from "../http";

function streamResponse<Done>(
  frames: AsyncGenerator<ChatStreamFrame, Done>,
  onDone?: (value: Done) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await frames.next();
      if (done) {
        // The reply already streamed; a failed history write must not error the stream.
        await onDone?.(value).catch((error) => console.error("Failed to persist model history", error));
        controller.close();
      } else controller.enqueue(encoder.encode(serializeFrame(value)));
    },
    async cancel() {
      await frames.return(undefined as Done);
    },
  });

  return new Response(body, {
    headers: { "content-type": STREAM_CONTENT_TYPE, "cache-control": "no-cache, no-transform" },
  });
}

// Failures before the stream starts keep the JSON error contract of POST /api/chat;
// failures after it starts arrive as an error frame, since the status is already sent.
export async function POST(request: Request) {
  const tracker = trackRequest("chat_stream");
  try {
    const { messages, model: requestedModel, sessionId } = await readChatRequest(request);

    // Slash commands are message-scoped: /tokens anywhere in the last user message
    // apply to this request and are stripped before the model sees it.
    const resolved = await resolveCommands(messages);
    if (resolved.reply !== null) {
      return streamResponse(trackStream(tracker, commandReplyFrames(resolved.reply, resolved.sources)));
    }

    const config = readConfig();
    const maxSteps = readMaxSteps();
    const systemPrompt = await readSystemPrompt();
    const knowledge = await readKnowledge();

    const prompt = [systemPrompt, ...resolved.contextTexts].filter(Boolean).join("\n\n");
    const context = {
      systemPrompt: prompt || null,
      knowledge,
      sources: resolved.sources,
      tools: builtinTools,
      maxSteps,
      ...(resolved.effort ? { effort: resolved.effort } : {}),
    };
    const model = resolved.model ?? requestedModel;
    const effectiveConfig = model ? { ...config, model } : config;
    const history = await openModelHistory(sessionId, resolved.messages);

    return streamResponse(
      trackStream(
        tracker,
        streamChat(history.messages, createOpenRouterModel(effectiveConfig), context, request.signal),
      ),
      history.commit,
    );
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat/stream");
  }
}
