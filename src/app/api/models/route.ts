import { ProviderError } from "@/core/errors";
import { LOCAL_MODEL_PREFIX } from "@/core/models/model";
import { errorResponse } from "../chat/http";

type ModelEntry = { id: string; name: string; provider: "public" | "local" };

// The OpenRouter model list is public; the API key rides along when configured so
// the list reflects what this key can actually use. Cached for an hour — the list
// changes rarely and the composer refetches it on every page load otherwise.
async function publicModels(apiKey: string | null): Promise<ModelEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new ProviderError(`OpenRouter models request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { data?: { id: string; name?: string }[] };
  return (body.data ?? [])
    .map(({ id, name }) => ({ id, name: name ?? id, provider: "public" as const }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// llama.cpp, LM Studio, and friends expose the OpenAI GET /models shape. Local ids
// carry the local/ prefix so the chat routes route them to this server — a
// local model's id can collide with an OpenRouter slug and still resolve right.
async function localModels(baseUrl: string, apiKey: string | null): Promise<ModelEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new ProviderError(`Local models request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { data?: { id: string }[] };
  return (body.data ?? [])
    .map(({ id }) => ({ id: `${LOCAL_MODEL_PREFIX}${id}`, name: id, provider: "local" as const }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
  const localBaseUrl = process.env.SPEKTER_LOCAL_BASE_URL?.trim() || null;
  const localApiKey = process.env.SPEKTER_LOCAL_API_KEY?.trim() || null;

  try {
    // A provider that fails lists no models rather than failing the whole route —
    // a stopped llama.cpp must not empty the OpenRouter dropdown and vice versa.
    const [pub, local] = await Promise.all([
      publicModels(apiKey).catch(() => []),
      localBaseUrl ? localModels(localBaseUrl, localApiKey).catch(() => []) : Promise.resolve([]),
    ]);
    return Response.json({ models: [...local, ...pub] });
  } catch (error) {
    return errorResponse(error, "GET /api/models");
  }
}
