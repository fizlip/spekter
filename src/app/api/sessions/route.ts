import { connection } from "next/server";
import { listSessions } from "@/interfaces/web/session-store";
import { errorResponse } from "../chat/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await listSessions());
  } catch (error) {
    return errorResponse(error, "GET /api/sessions");
  }
}
