import { completeChat } from "@/core/chat/complete";
import { parseChatRequest, type ChatResponse } from "@/core/chat/contract";
import { readConfig } from "@/core/config";
import { InvalidRequestError, SpekterError, type ErrorCode } from "@/core/errors";
import { createOpenRouterModel } from "@/core/models/openrouter";

const statusByCode: Record<ErrorCode, number> = {
  invalid_request: 400,
  not_configured: 503,
  provider_error: 502,
};

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new InvalidRequestError("Content-Type must be application/json");
    }
    const body = await request.json().catch(() => {
      throw new InvalidRequestError("Request body must be valid JSON");
    });
    const { messages } = parseChatRequest(body);
    const config = readConfig();
    const content = await completeChat(messages, createOpenRouterModel(config));

    return Response.json({
      message: { role: "assistant", content },
      model: config.model,
    } satisfies ChatResponse);
  } catch (error) {
    if (error instanceof SpekterError) {
      return errorResponse(statusByCode[error.code], error.code, error.message);
    }
    console.error("Unexpected error in POST /api/chat", error);
    return errorResponse(500, "internal_error", "Unexpected server error");
  }
}

function errorResponse(status: number, code: ErrorCode | "internal_error", message: string) {
  return Response.json({ error: { code, message } }, { status });
}
