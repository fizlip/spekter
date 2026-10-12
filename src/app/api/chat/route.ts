import { completeChat } from "@/core/chat/complete";
import type { ChatResponse } from "@/core/chat/contract";
import { readSystemPrompt } from "@/core/chat/system-prompt";
import { readConfig } from "@/core/config";
import { trackRequest } from "@/core/instrumentation/request-log";
import { readKnowledge } from "@/core/knowledge/markdown-folder";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { errorResponse, readChatMessages } from "./http";

export async function POST(request: Request) {
  const tracker = trackRequest("chat");
  try {
    const messages = await readChatMessages(request);
    const config = readConfig();
    const systemPrompt = await readSystemPrompt();
    const knowledge = await readKnowledge();
    const { text, sources } = await completeChat(messages, createOpenRouterModel(config), { systemPrompt, knowledge });
    void tracker.reply();

    return Response.json({
      message: { role: "assistant", content: text },
      model: config.model,
      sources,
    } satisfies ChatResponse);
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat");
  }
}
