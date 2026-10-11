import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Env } from "../config";
import { NotConfiguredError } from "../errors";

// Reads the configured system-prompt file per request: unset or blank means no prompt,
// and a configured file that cannot be read is a configuration error, never a silent drop.
export async function readSystemPrompt(env: Env = process.env): Promise<string | null> {
  const configured = env.SPEKTER_SYSTEM_PROMPT?.trim();
  if (!configured) return null;

  const path = resolve(configured);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    throw new NotConfiguredError(`Cannot read system prompt file: ${path} (set in SPEKTER_SYSTEM_PROMPT)`);
  }
  return content.trim() ? content : null;
}
