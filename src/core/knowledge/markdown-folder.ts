import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Env } from "../config";
import { NotConfiguredError } from "../errors";

export type KnowledgeNote = { path: string; content: string };

const VARIABLE = "SPEKTER_KNOWLEDGE_DIR";

// Reads every .md note in the configured folder per request: unset means no knowledge,
// and a configured folder or note that cannot be read is a configuration error, never a silent drop.
// Hidden files and folders, symlinks, and whitespace-only notes are skipped; notes are ordered by path.
export async function readKnowledge(env: Env = process.env): Promise<KnowledgeNote[]> {
  const configured = env[VARIABLE]?.trim();
  if (!configured) return [];

  const folder = resolve(configured);
  let entries;
  try {
    entries = await readdir(folder, { recursive: true, withFileTypes: true });
  } catch {
    throw new NotConfiguredError(`Cannot read knowledge folder: ${folder} (set in ${VARIABLE})`);
  }

  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.split("/").some((segment) => segment.startsWith(".")))
    .sort();

  const notes = await Promise.all(
    paths.map(async (path) => {
      const file = join(folder, path);
      try {
        return { path, content: await readFile(file, "utf-8") };
      } catch {
        throw new NotConfiguredError(`Cannot read knowledge note: ${file} (set in ${VARIABLE})`);
      }
    }),
  );
  return notes.filter((note) => note.content.trim());
}
