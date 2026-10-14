import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFileTool } from "./delete-file";
import { editFileTool } from "./edit-file";
import { listFilesTool } from "./list-files";
import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";

// The tools resolve paths against cwd, so tests run in a temp dir carrying the
// default scopes (skills/, knowledge/).
let workDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  workDir = join(tmpdir(), `spekter-files-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(workDir, "skills"), { recursive: true });
  await mkdir(join(workDir, "knowledge"), { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workDir);
  vi.stubEnv("SPEKTER_FILE_DIRS", "");
});

afterEach(async () => {
  cwdSpy.mockRestore();
  vi.unstubAllEnvs();
  await rm(workDir, { recursive: true, force: true });
});

describe("read_file", () => {
  it("reads a file inside an allowed folder", async () => {
    await writeFile(join(workDir, "knowledge", "notes.md"), "hello");
    expect(await readFileTool.execute({ path: "knowledge/notes.md" }, {})).toEqual({
      path: "knowledge/notes.md",
      content: "hello",
    });
  });

  it("rejects paths outside the allowed folders", async () => {
    await expect(readFileTool.execute({ path: "../secret.txt" }, {})).rejects.toThrow(
      "must stay inside",
    );
    await expect(readFileTool.execute({ path: "/etc/passwd" }, {})).rejects.toThrow("must stay inside");
    await expect(readFileTool.execute({ path: "src/core/config.ts" }, {})).rejects.toThrow(
      "must stay inside",
    );
  });
});

describe("list_files", () => {
  it("lists every allowed folder when no path is given", async () => {
    await mkdir(join(workDir, "skills", "a"), { recursive: true });
    await writeFile(join(workDir, "skills", "a", "SKILL.md"), "");
    await writeFile(join(workDir, "knowledge", "b.md"), "");
    // Nothing outside the scopes is listed even though other dirs may exist.
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src", "x.ts"), "");

    const { files } = await listFilesTool.execute({}, {});
    expect(files).toEqual(["knowledge/b.md", "skills/a/SKILL.md"]);
  });

  it("skips hidden files", async () => {
    await writeFile(join(workDir, "knowledge", ".hidden.md"), "");
    expect((await listFilesTool.execute({}, {})).files).toEqual([]);
  });
});

describe("write_file", () => {
  it("creates a file with its parent folders", async () => {
    expect(
      await writeFileTool.execute({ path: "skills/new-skill/SKILL.md", content: "# New" }, {}),
    ).toEqual({ path: "skills/new-skill/SKILL.md", bytes: 5 });
    expect(await readFileTool.execute({ path: "skills/new-skill/SKILL.md" }, {})).toMatchObject({
      content: "# New",
    });
  });

  it("refuses to write outside the allowed folders", async () => {
    await expect(
      writeFileTool.execute({ path: "package.json", content: "{}" }, {}),
    ).rejects.toThrow("must stay inside");
  });
});

describe("edit_file", () => {
  it("replaces the unique match", async () => {
    await writeFile(join(workDir, "skills", "s.md"), "alpha beta gamma");
    await editFileTool.execute({ path: "skills/s.md", old_string: "beta", new_string: "BETA" }, {});
    expect((await readFileTool.execute({ path: "skills/s.md" }, {})).content).toBe("alpha BETA gamma");
  });

  it("fails when old_string is missing or ambiguous", async () => {
    await writeFile(join(workDir, "skills", "s.md"), "beta beta beta");
    await expect(
      editFileTool.execute({ path: "skills/s.md", old_string: "nope", new_string: "x" }, {}),
    ).rejects.toThrow("not found");
    await expect(
      editFileTool.execute({ path: "skills/s.md", old_string: "beta", new_string: "x" }, {}),
    ).rejects.toThrow("3 times");
  });
});

describe("delete_file", () => {
  it("deletes a file and refuses folders", async () => {
    await writeFile(join(workDir, "knowledge", "gone.md"), "");
    expect(await deleteFileTool.execute({ path: "knowledge/gone.md" }, {})).toEqual({
      path: "knowledge/gone.md",
      deleted: true,
    });
    await expect(deleteFileTool.execute({ path: "knowledge" }, {})).rejects.toThrow("Not a file");
  });
});

describe("scope", () => {
  it("follows SPEKTER_FILE_DIRS", async () => {
    await mkdir(join(workDir, "docs"), { recursive: true });
    await writeFile(join(workDir, "docs", "a.md"), "doc");
    vi.stubEnv("SPEKTER_FILE_DIRS", "docs");
    expect(await readFileTool.execute({ path: "docs/a.md" }, {})).toMatchObject({ content: "doc" });
    await expect(readFileTool.execute({ path: "skills/x.md" }, {})).rejects.toThrow(
      "must stay inside",
    );
  });
});
