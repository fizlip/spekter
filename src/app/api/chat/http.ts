import { parseChatRequest, type ChatMessage } from "@/core/chat/contract";
import { InvalidRequestError, SpekterError, type ErrorCode } from "@/core/errors";

const statusByCode: Record<ErrorCode, number> = {
  invalid_request: 400,
  not_configured: 503,
  provider_error: 502,
};

export async function readChatMessages(request: Request): Promise<ChatMessage[]> {
  const body = await request.json().catch(() => {
    throw new InvalidRequestError("Request body must be valid JSON");
  });
  return parseChatRequest(body).messages;
}

export function errorResponse(error: unknown, routeLabel: string): Response {
  if (error instanceof SpekterError) {
    return jsonError(statusByCode[error.code], error.code, error.message);
  }
  console.error(`Unexpected error in ${routeLabel}`, error);
  return jsonError(500, "internal_error", "Unexpected server error");
}

function jsonError(status: number, code: ErrorCode | "internal_error", message: string) {
  return Response.json({ error: { code, message } }, { status });
}
