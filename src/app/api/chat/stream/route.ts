import { streamChat } from "@/core/chat/stream";
import { serializeFrame, STREAM_CONTENT_TYPE } from "@/core/chat/stream-frames";
import { readConfig } from "@/core/config";
import { trackRequest, trackStream } from "@/core/instrumentation/request-log";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { errorResponse, readChatMessages } from "../http";

// Failures before the stream starts keep the JSON error contract of POST /api/chat;
// failures after it starts arrive as an error frame, since the status is already sent.
export async function POST(request: Request) {
  const tracker = trackRequest("chat_stream");
  try {
    const messages = await readChatMessages(request);
    const frames = trackStream(tracker, streamChat(messages, createOpenRouterModel(readConfig()), request.signal));
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
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat/stream");
  }
}
