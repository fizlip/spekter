import { completeChat } from "@/core/chat/complete";
import { resolveCommands } from "@/core/chat/commands";
import { openModelHistory } from "@/core/chat/model-history";
import type { ChatResponse } from "@/core/chat/contract";
import { readSystemPrompt } from "@/core/chat/system-prompt";
import { readConfig, readMaxSteps } from "@/core/config";
import { trackRequest } from "@/core/instrumentation/request-log";
import { readKnowledge } from "@/core/knowledge/markdown-folder";
import { createChatModel, resolveModelConfig } from "@/core/models/model";
import { builtinTools } from "@/core/tools/registry";
import { errorResponse, readChatRequest } from "./http";

export async function POST(request: Request) {
  const tracker = trackRequest("chat");
  try {
    const { messages, model: requestedModel, sessionId } = await readChatRequest(request);

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
    const model = resolved.model ?? requestedModel ?? config.model;
    const history = await openModelHistory(sessionId, resolved.messages);
    const { text, sources, produced } = await completeChat(
      history.messages,
      createChatModel(resolveModelConfig(config, model)),
      context,
    );
    // A failed history write degrades the next turn's context, never this reply.
    await history.commit(produced).catch((error) => console.error("Failed to persist model history", error));
    void tracker.reply();

    return Response.json({
      message: { role: "assistant", content: text },
      model,
      sources,
    } satisfies ChatResponse);
  } catch (error) {
    void tracker.fail(error);
    return errorResponse(error, "POST /api/chat");
  }
}
