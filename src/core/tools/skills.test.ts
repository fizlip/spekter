import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSkillsTool } from "./list-skills";
import { skillMetadataTool } from "./skill-metadata";

// skillsDir resolves against cwd, so tests run in a temp dir holding a skills/ folder.
let workDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  workDir = join(tmpdir(), `spekter-skills-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(workDir, "skills"), { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workDir);
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await rm(workDir, { recursive: true, force: true });
});

const writeSkill = (name: string, content: string) =>
  mkdir(join(workDir, "skills", name), { recursive: true }).then(() =>
    writeFile(join(workDir, "skills", name, "SKILL.md"), content),
  );

const DEMO = `---
name: demo
description: "Does demo things, quoted like some skills do."
argument-hint: "[task]"
---

# Demo

The body never reaches the listing.
`;

describe("list_skills", () => {
  it("returns every skill's metadata without its body", async () => {
    await writeSkill("demo", DEMO);
    await writeSkill("other", "---\nname: other\ndescription: plain\n---\n");

    const { skills } = await listSkillsTool.execute({}, {});

    expect(skills).toEqual([
      {
        name: "demo",
        path: join("skills", "demo", "SKILL.md"),
        metadata: { name: "demo", description: "Does demo things, quoted like some skills do.", "argument-hint": "[task]" },
      },
      {
        name: "other",
        path: join("skills", "other", "SKILL.md"),
        metadata: { name: "other", description: "plain" },
      },
    ]);
  });

  it("lists a SKILL.md without a --- block with metadata: null, and skips non-skills", async () => {
    await writeSkill("no-frontmatter", "# Just a heading\n");
    await mkdir(join(workDir, "skills", "empty-dir"), { recursive: true });
    await writeSkill(".hidden", "---\nname: hidden\n---\n");
    await writeFile(join(workDir, "skills", "loose-file.md"), "---\nname: not-a-dir\n---\n");

    const { skills } = await listSkillsTool.execute({}, {});

    expect(skills).toEqual([
      { name: "no-frontmatter", path: join("skills", "no-frontmatter", "SKILL.md"), metadata: null },
    ]);
  });

  it("returns an empty list when the skills folder is missing", async () => {
    cwdSpy.mockReturnValue(join(workDir, "elsewhere"));
    expect(await listSkillsTool.execute({}, {})).toEqual({ skills: [] });
  });
});

describe("skill_metadata", () => {
  it("reads one skill's metadata by folder name", async () => {
    await writeSkill("demo", DEMO);

    expect(await skillMetadataTool.execute({ name: "demo" }, {})).toEqual({
      name: "demo",
      path: join("skills", "demo", "SKILL.md"),
      metadata: { name: "demo", description: "Does demo things, quoted like some skills do.", "argument-hint": "[task]" },
    });
  });

  it("fails on unknown skills, path-like names, and skills without a metadata block", async () => {
    await writeSkill("no-frontmatter", "# Just a heading\n");

    await expect(skillMetadataTool.execute({ name: "nope" }, {})).rejects.toThrow("No such skill");
    await expect(skillMetadataTool.execute({ name: "../etc" }, {})).rejects.toThrow("Not a skill name");
    await expect(skillMetadataTool.execute({ name: "no-frontmatter" }, {})).rejects.toThrow(
      "no metadata block",
    );
  });
});
