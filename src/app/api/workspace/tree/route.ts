import { connection } from "next/server";
import { readWorkspaceTrees } from "@/core/workspace/tree";
import { errorResponse } from "../../chat/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await readWorkspaceTrees());
  } catch (error) {
    return errorResponse(error, "GET /api/workspace/tree");
  }
}
