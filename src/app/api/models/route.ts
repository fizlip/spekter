import { ProviderError } from "@/core/errors";
import { errorResponse } from "../chat/http";

type OpenRouterModel = { id: string; name?: string };

// The OpenRouter model list is public; the API key rides along when configured so
// the list reflects what this key can actually use. Cached for an hour — the list
// changes rarely and the composer refetches it on every page load otherwise.
export async function GET() {
  try {
    const headers: Record<string, string> = {};
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      throw new ProviderError(`OpenRouter models request failed with status ${response.status}`);
    }

    const body = (await response.json()) as { data?: OpenRouterModel[] };
    const models = (body.data ?? [])
      .map(({ id, name }) => ({ id, name: name ?? id }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return Response.json({ models });
  } catch (error) {
    return errorResponse(error, "GET /api/models");
  }
}
