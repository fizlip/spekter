import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "./session";
import { isValidSessionId, listSessions, readSession, saveSession } from "./session-store";

const session = (id: string, updatedAt = "2026-10-21T10:00:00Z") =>
  buildSession({
    id,
    model: "openai/gpt-test",
    messages: [
      { id: "u1", role: "user", content: `hello from ${id}`, createdAt: updatedAt },
      { id: "a1", role: "assistant", content: "hi", createdAt: updatedAt },
    ],
    createdAt: updatedAt,
    now: updatedAt,
  });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-sessions-"));
  vi.stubEnv("SPEKTER_SESSIONS_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("saveSession / readSession", () => {
  it("round-trips a session to <id>.json", async () => {
    const stored = session("abc-123");
    await saveSession(stored);
    expect(await readSession("abc-123")).toEqual(stored);
  });

  it("returns null for an unknown id", async () => {
    expect(await readSession("nope")).toBeNull();
  });

  it("rejects ids that could escape the sessions directory", async () => {
    expect(isValidSessionId("../evil")).toBe(false);
    expect(isValidSessionId("a/b")).toBe(false);
    expect(isValidSessionId("..")).toBe(false);
    expect(isValidSessionId("abc-123_def")).toBe(true);
    await expect(saveSession(session("../evil"))).rejects.toThrow();
    expect(await readSession("../evil")).toBeNull();
  });
});

describe("listSessions", () => {
  it("returns [] for a missing or empty directory", async () => {
    await rm(dir, { recursive: true, force: true });
    expect(await listSessions()).toEqual([]);
  });

  it("skips malformed session files", async () => {
    await saveSession(session("good"));
    await writeFile(join(dir, "bad.json"), "{not json");
    await writeFile(join(dir, "wrong.json"), JSON.stringify({ nope: true }));
    expect((await listSessions()).map((s) => s.id)).toEqual(["good"]);
  });

  it("orders by updatedAt descending", async () => {
    await saveSession(session("old", "2026-10-19T10:00:00Z"));
    await saveSession(session("new", "2026-10-21T10:00:00Z"));
    await saveSession(session("mid", "2026-10-20T10:00:00Z"));
    expect((await listSessions()).map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });
});
