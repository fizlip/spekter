import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotConfiguredError } from "../errors";
import { readKnowledge } from "./markdown-folder";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-knowledge-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeNote(path: string, content: string) {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content);
}

describe("readKnowledge", () => {
  it("returns no notes when the variable is unset or blank", async () => {
    await expect(readKnowledge({})).resolves.toEqual([]);
    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: "  " })).resolves.toEqual([]);
  });

  it("returns every note, subfolders included, ordered by path with content verbatim", async () => {
    await writeNote("b.md", "Bee\n");
    await writeNote("a.md", "# A\n\n  indented  \n\n");
    await writeNote("sub/c.md", "See");

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: dir })).resolves.toEqual([
      { path: "a.md", content: "# A\n\n  indented  \n\n" },
      { path: "b.md", content: "Bee\n" },
      { path: "sub/c.md", content: "See" },
    ]);
  });

  it("skips non-markdown files, hidden files and folders, and whitespace-only notes", async () => {
    await writeNote("notes.txt", "text");
    await writeNote(".hidden.md", "hidden");
    await writeNote(".obsidian/x.md", "tool state");
    await writeNote("blank.md", "  \n\t\n");
    await writeNote("UPPER.MD", "upper");

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: dir })).resolves.toEqual([
      { path: "UPPER.MD", content: "upper" },
    ]);
  });

  it("returns no notes for an empty folder", async () => {
    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: dir })).resolves.toEqual([]);
  });

  it("skips symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "spekter-knowledge-outside-"));
    try {
      await writeFile(join(outside, "note.md"), "outside");
      await symlink(join(outside, "note.md"), join(dir, "link.md"));

      await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: dir })).resolves.toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("throws NotConfiguredError naming the folder and the variable when the folder is missing", async () => {
    const path = join(dir, "missing");

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: path })).rejects.toThrow(
      new NotConfiguredError(`Cannot read knowledge folder: ${path} (set in SPEKTER_KNOWLEDGE_DIR)`),
    );
  });

  it("throws the same error when the path is a file", async () => {
    await writeNote("file.md", "not a folder");
    const path = join(dir, "file.md");

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: path })).rejects.toThrow(
      new NotConfiguredError(`Cannot read knowledge folder: ${path} (set in SPEKTER_KNOWLEDGE_DIR)`),
    );
  });

  it("throws NotConfiguredError naming the note when a note cannot be read", async () => {
    await writeNote("locked.md", "secret");
    await chmod(join(dir, "locked.md"), 0o000);

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: dir })).rejects.toThrow(
      new NotConfiguredError(`Cannot read knowledge note: ${join(dir, "locked.md")} (set in SPEKTER_KNOWLEDGE_DIR)`),
    );
  });

  it("resolves a relative path against the server working directory", async () => {
    const relative = "spekter-no-such-knowledge";

    await expect(readKnowledge({ SPEKTER_KNOWLEDGE_DIR: relative })).rejects.toThrow(
      `Cannot read knowledge folder: ${join(process.cwd(), relative)} (set in SPEKTER_KNOWLEDGE_DIR)`,
    );
  });
});
