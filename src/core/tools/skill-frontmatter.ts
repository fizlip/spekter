import { readFile } from "node:fs/promises";
import { resolveToolPath } from "./scoped-path";

// Skills live in the project's skills/ folder regardless of SPEKTER_FILE_DIRS: that scope
// governs what the file tools may touch, not where skills are stored.
export const skillsDir = () => resolveToolPath("skills");

// A SKILL.md's metadata is the flat `key: value` block between the --- markers on its first
// lines. That frontmatter never nests, so matching scalars beats pulling in a YAML parser;
// continuation lines of a wrapped value join onto the previous key.
export function parseSkillFrontmatter(block: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  let key: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      key = match[1];
      metadata[key] = match[2].replace(/^(["'])([\s\S]*)\1$/, "$2");
    } else if (key && line.trim()) {
      metadata[key] += ` ${line.trim()}`;
    }
  }
  return metadata;
}

// The parsed block, or null when the file is unreadable or carries no --- markers.
export async function readSkillMetadata(file: string): Promise<Record<string, string> | null> {
  const content = await readFile(file, "utf-8").catch(() => null);
  const block = content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  return block ? parseSkillFrontmatter(block) : null;
}
