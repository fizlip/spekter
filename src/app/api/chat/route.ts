import { completeChat } from "@/core/chat/complete";
import { resolveCommands } from "@/core/chat/commands";
import type { ChatResponse } from "@/core/chat/contract";
import { readSystemPrompt } from "@/core/chat/system-prompt";
import { readConfig } from "@/core/config";
import { trackRequest } from "@/core/instrumentation/request-log";
import { readKnowledge } from "@/core/knowledge/markdown-folder";
import { createOpenRouterModel } from "@/core/models/openrouter";
import { errorResponse, readChatRequest } from "./http";

export async function POST(request: Request) {
  const tracker = trackRequest("chat");
  try {
    const { messages, model: requestedModel } = await readChatRequest(request);

    // Slash commands are message-scoped: /tokens anywhere in the last user message
    // apply to this request and are stripped before the model sees it.
    const resolved = await resolveCommands(messages);
    if (resolved.reply !== null) {
      void tracker.reply();
      return Response.json({
        message: { role: "assistant", content: resolved.reply },
        model: "spekter",
        sources: resolved.sources,
      } satisfies ChatResponse);
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
    const model = resolved.model ?? requestedModel;
    const effectiveConfig = model ? { ...config, model } : config;
    const { text, sources } = await completeChat(
      resolved.messages,
      createOpenRouterModel(effectiveConfig),
      context,
    );
    void tracker.reply();

    return Response.json({
      message: { role: "assistant", content: text },
      model: effectiveConfig.model,
      sources,
    } satisfies ChatResponse);
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat");
  }
}
