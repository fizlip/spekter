import type { SessionSummary, StoredSession } from "./session";

async function readError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const message =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string } }).error?.message
      : undefined;
  return new Error(message ?? `Request failed with status ${response.status}`);
}

export async function listSessions(): Promise<SessionSummary[]> {
  const response = await fetch("/api/sessions");
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function getSession(id: string): Promise<StoredSession | null> {
  const response = await fetch(`/api/sessions/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function putSession(session: StoredSession): Promise<void> {
  const response = await fetch(`/api/sessions/${session.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session),
  });
  if (!response.ok) throw await readError(response);
}
