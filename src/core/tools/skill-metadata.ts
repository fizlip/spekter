import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { statIfExists } from "./scoped-path";
import { readSkillMetadata, skillsDir } from "./skill-frontmatter";
import type { SpekterTool } from "./types";

// Skill folders are simple slugs; refusing anything else keeps the name from becoming a path.
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const inputSchema = z.object({
  name: z.string().min(1).describe("Skill folder name under skills/, e.g. 'latex-pdf'"),
});

export const skillMetadataTool: SpekterTool<
  typeof inputSchema,
  { name: string; path: string; metadata: Record<string, string> }
> = {
  name: "skill_metadata",
  description:
    "Read only the metadata block (the --- frontmatter at the top) of one skill's SKILL.md — cheaper than read_file when you just need a skill's name and description. Use list_skills to see every skill's metadata at once.",
  inputSchema,
  execute: async ({ name }) => {
    if (!SKILL_NAME.test(name)) throw new Error(`Not a skill name: ${name}`);
    const file = join(skillsDir(), name, "SKILL.md");
    const info = await statIfExists(file);
    if (!info?.isFile()) throw new Error(`No such skill: ${name}`);
    const metadata = await readSkillMetadata(file);
    if (!metadata) throw new Error(`Skill has no metadata block: ${name}`);
    return { name, path: relative(resolve(), file), metadata };
  },
};
