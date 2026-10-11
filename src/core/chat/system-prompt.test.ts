import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotConfiguredError } from "../errors";
import { readSystemPrompt } from "./system-prompt";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-system-prompt-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readSystemPrompt", () => {
  it("returns null when the variable is unset", async () => {
    await expect(readSystemPrompt({})).resolves.toBeNull();
  });

  it("returns null when the variable is blank", async () => {
    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: "   " })).resolves.toBeNull();
  });

  it("returns the file's content verbatim, preserving whitespace and trailing newlines", async () => {
    const path = join(dir, "prompt.md");
    await writeFile(path, "# Instructions\n\nBe terse.  \n\n");

    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: path })).resolves.toBe(
      "# Instructions\n\nBe terse.  \n\n",
    );
  });

  it("returns null when the file is empty or whitespace-only", async () => {
    const path = join(dir, "empty.md");
    await writeFile(path, "  \n\t\n");

    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: path })).resolves.toBeNull();
  });

  it("throws NotConfiguredError naming the file and the variable when the file is missing", async () => {
    const path = join(dir, "missing.md");

    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: path })).rejects.toThrow(
      new NotConfiguredError(`Cannot read system prompt file: ${path} (set in SPEKTER_SYSTEM_PROMPT)`),
    );
  });

  it("throws the same error when the path is a directory", async () => {
    const path = join(dir, "subdir");
    await mkdir(path);

    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: path })).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("resolves a relative path against the server working directory", async () => {
    const relative = "spekter-no-such-prompt.md";

    await expect(readSystemPrompt({ SPEKTER_SYSTEM_PROMPT: relative })).rejects.toThrow(
      `Cannot read system prompt file: ${join(process.cwd(), relative)} (set in SPEKTER_SYSTEM_PROMPT)`,
    );
  });
});
