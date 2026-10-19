import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFileTool } from "./delete-file";
import { editFileTool } from "./edit-file";
import { listFilesTool } from "./list-files";
import { MAX_READ_BYTES, readFileTool } from "./read-file";
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

// A sandbox guest writes the workspace tree, so links and special files inside an allowed
// folder are attacker-controlled: they must never reach outside it or wedge a tool call.
describe("symlink and special-file containment", () => {
  let outside: string;

  beforeEach(async () => {
    outside = join(workDir, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "top secret");
  });

  it("rejects every file tool through a link pointing outside the allowed folders", async () => {
    await symlink(join(outside, "secret.txt"), join(workDir, "knowledge", "h"));

    await expect(readFileTool.execute({ path: "knowledge/h" }, {})).rejects.toThrow("must stay inside");
    await expect(writeFileTool.execute({ path: "knowledge/h", content: "pwned" }, {})).rejects.toThrow("must stay inside");
    await expect(editFileTool.execute({ path: "knowledge/h", old_string: "top", new_string: "x" }, {})).rejects.toThrow("must stay inside");
    await expect(deleteFileTool.execute({ path: "knowledge/h" }, {})).rejects.toThrow("must stay inside");
    expect(await readFile(join(outside, "secret.txt"), "utf-8")).toBe("top secret");
  });

  it("rejects a path whose folder component is a link pointing outside", async () => {
    await symlink(outside, join(workDir, "knowledge", "link"));

    await expect(readFileTool.execute({ path: "knowledge/link/secret.txt" }, {})).rejects.toThrow("must stay inside");
    await expect(writeFileTool.execute({ path: "knowledge/link/new.txt", content: "x" }, {})).rejects.toThrow("must stay inside");
    await expect(readFile(join(outside, "new.txt"))).rejects.toThrow();
  });

  it("refuses to write through a dangling link that would create a file outside", async () => {
    await symlink(join(outside, "created.txt"), join(workDir, "knowledge", "dangling"));

    await expect(writeFileTool.execute({ path: "knowledge/dangling", content: "x" }, {})).rejects.toThrow("must stay inside");
    await expect(readFile(join(outside, "created.txt"))).rejects.toThrow();
  });

  it("still follows a link that stays inside the allowed folders", async () => {
    await writeFile(join(workDir, "skills", "real.md"), "inside");
    await symlink(join(workDir, "skills", "real.md"), join(workDir, "knowledge", "alias.md"));

    expect(await readFileTool.execute({ path: "knowledge/alias.md" }, {})).toMatchObject({ content: "inside" });
  });

  it("works when the project itself sits under a symlinked path", async () => {
    const linkedProject = join(tmpdir(), `spekter-linked-${Math.random().toString(36).slice(2)}`);
    await symlink(workDir, linkedProject);
    cwdSpy.mockReturnValue(linkedProject);
    await writeFile(join(workDir, "knowledge", "n.md"), "via link");

    try {
      expect(await readFileTool.execute({ path: "knowledge/n.md" }, {})).toMatchObject({ content: "via link" });
      expect(await writeFileTool.execute({ path: "knowledge/new/a.md", content: "ok" }, {})).toMatchObject({ bytes: 2 });
    } finally {
      await rm(linkedProject);
    }
  });

  it("rejects a FIFO instead of blocking on it", async () => {
    execFileSync("mkfifo", [join(workDir, "knowledge", "pipe")]);

    await expect(readFileTool.execute({ path: "knowledge/pipe" }, {})).rejects.toThrow("Not a file: knowledge/pipe");
    await expect(writeFileTool.execute({ path: "knowledge/pipe", content: "x" }, {})).rejects.toThrow("Not a file: knowledge/pipe");
    await expect(editFileTool.execute({ path: "knowledge/pipe", old_string: "a", new_string: "b" }, {})).rejects.toThrow("Not a file: knowledge/pipe");
  });

  it("caps how much of an oversized file read_file returns", async () => {
    await writeFile(join(workDir, "knowledge", "huge.log"), "x".repeat(MAX_READ_BYTES + 5000));

    const result = await readFileTool.execute({ path: "knowledge/huge.log" }, {});
    expect(result.content).toHaveLength(MAX_READ_BYTES);
    expect(result).toMatchObject({ truncated: true });
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
