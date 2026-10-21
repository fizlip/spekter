import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { InvalidRequestError } from "@/core/errors";
import { sessionSchema, summarize, type SessionSummary, type StoredSession } from "./session";

const DEFAULT_DIR = "sessions";
// Filename-safe only: keeps ids like uuids while blocking anything that could
// escape the sessions directory.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function sessionsDir() {
  return resolve(process.env.SPEKTER_SESSIONS_DIR?.trim() || DEFAULT_DIR);
}

export function isValidSessionId(id: string): boolean {
  return SAFE_ID.test(id);
}

function sessionPath(dir: string, id: string) {
  return join(dir, `${id}.json`);
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!isValidSessionId(session.id)) throw new InvalidRequestError("Invalid session id");
  const result = sessionSchema.safeParse(session);
  if (!result.success) throw new InvalidRequestError("Session body failed validation");

  const dir = sessionsDir();
  await mkdir(dir, { recursive: true });
  // Write-then-rename keeps a killed write from leaving a torn session file.
  const tmp = join(dir, `.${session.id}.json.tmp`);
  await writeFile(tmp, JSON.stringify(result.data, null, 2));
  await rename(tmp, sessionPath(dir, session.id));
}

// A missing, invalid, or malformed file reads as absent rather than failing.
export async function readSession(id: string): Promise<StoredSession | null> {
  if (!isValidSessionId(id)) return null;
  let content: string;
  try {
    content = await readFile(sessionPath(sessionsDir(), id), "utf-8");
  } catch {
    return null;
  }
  try {
    const result = sessionSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(sessionsDir());
  } catch {
    return [];
  }
  const summaries: SessionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const session = await readSession(file.slice(0, -".json".length));
    if (session) summaries.push(summarize(session));
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
