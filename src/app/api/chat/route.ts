import { completeChat } from "@/core/chat/complete";
import type { ChatResponse } from "@/core/chat/contract";
import { readConfig } from "@/core/config";
import { trackRequest } from "@/core/instrumentation/request-log";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { errorResponse, readChatMessages } from "./http";

export async function POST(request: Request) {
  const tracker = trackRequest("chat");
  try {
    const messages = await readChatMessages(request);
    const config = readConfig();
    const content = await completeChat(messages, createOpenRouterModel(config));
    void tracker.reply();

    return Response.json({
      message: { role: "assistant", content },
      model: config.model,
    } satisfies ChatResponse);
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat");
  }
}
