import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { statIfExists } from "./scoped-path";
import { readSkillMetadata, skillsDir } from "./skill-frontmatter";
import type { SpekterTool } from "./types";

const inputSchema = z.object({});

type SkillEntry = { name: string; path: string; metadata: Record<string, string> | null };

// Discovery without the price of a full read: an agent scans this list to decide whether a
// skill fits before spending tokens on its SKILL.md.
export const listSkillsTool: SpekterTool<typeof inputSchema, { skills: SkillEntry[] }> = {
  name: "list_skills",
  description:
    "List every skill under skills/ with the metadata block (name, description, ...) from the top of its SKILL.md — far cheaper than reading each file. Use this to decide whether a skill fits the task, then read that skill's SKILL.md with read_file. A skill whose file lacks the --- metadata block is listed with metadata: null.",
  inputSchema,
  execute: async () => {
    const dir = skillsDir();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const skills: SkillEntry[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
      const file = join(dir, entry.name, "SKILL.md");
      const info = await statIfExists(file);
      if (!info?.isFile()) continue;
      skills.push({ name: entry.name, path: relative(resolve(), file), metadata: await readSkillMetadata(file) });
    }
    return { skills };
  },
};
