import { commandReplyFrames, resolveCommands } from "@/core/chat/commands";
import { streamChat } from "@/core/chat/stream";
import { serializeFrame, STREAM_CONTENT_TYPE, type ChatStreamFrame } from "@/core/chat/stream-frames";
import { readSystemPrompt } from "@/core/chat/system-prompt";
import { readConfig } from "@/core/config";
import { trackRequest, trackStream } from "@/core/instrumentation/request-log";
import { readKnowledge } from "@/core/knowledge/markdown-folder";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { errorResponse, readChatMessages } from "../http";

function streamResponse(frames: AsyncGenerator<ChatStreamFrame>): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await frames.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(serializeFrame(value)));
    },
    async cancel() {
      await frames.return(undefined);
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
    const messages = await readChatMessages(request);

    // Slash commands are message-scoped: /tokens anywhere in the last user message
    // apply to this request and are stripped before the model sees it.
    const resolved = await resolveCommands(messages);
    if (resolved.reply !== null) {
      return streamResponse(trackStream(tracker, commandReplyFrames(resolved.reply, resolved.sources)));
    }

    const config = readConfig();
    const systemPrompt = await readSystemPrompt();
    const knowledge = await readKnowledge();

    const prompt = [systemPrompt, ...resolved.contextTexts].filter(Boolean).join("\n\n");
    const context = {
      systemPrompt: prompt || null,
      knowledge,
      sources: resolved.sources,
      ...(resolved.effort ? { effort: resolved.effort } : {}),
    };
    const effectiveConfig = resolved.model ? { ...config, model: resolved.model } : config;

    return streamResponse(
      trackStream(
        tracker,
        streamChat(resolved.messages, createOpenRouterModel(effectiveConfig), context, request.signal),
      ),
    );
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat/stream");
  }
}
