import { connection } from "next/server";
import { InvalidRequestError } from "@/core/errors";
import { readSession, saveSession } from "@/interfaces/web/session-store";
import { errorResponse } from "../../chat/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    const session = await readSession(id);
    if (!session) return Response.json({ error: { code: "not_found", message: "Session not found" } }, { status: 404 });
    return Response.json(session);
  } catch (error) {
    return errorResponse(error, "GET /api/sessions/[id]");
  }
}

// The client owns the transcript and pushes the whole session each settled turn;
// the chat request contract is untouched.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Cross-origin JSON bodies are not "simple requests", so this forces a
    // preflight that never succeeds — the same gate every mutating route keeps.
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new InvalidRequestError("Content-Type must be application/json");
    }
    const { id } = await params;
    const body = await request.json().catch(() => {
      throw new InvalidRequestError("Request body must be valid JSON");
    });
    if (typeof body !== "object" || body === null || (body as { id?: unknown }).id !== id) {
      throw new InvalidRequestError("Session id must match the URL");
    }
    await saveSession(body as Parameters<typeof saveSession>[0]);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PUT /api/sessions/[id]");
  }
}
