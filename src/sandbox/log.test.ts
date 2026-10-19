import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog } from "./log";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createEventLog", () => {
  it("appends one JSON line per event, creating missing directories", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T10:00:00.000Z"), toFake: ["Date"] });
    const path = join(await mkdtemp(join(tmpdir(), "sandboxd-log-")), "a", "sandboxd.jsonl");
    const log = createEventLog(path);

    await log("daemon_start", { port: 3210 });
    await log("box.destroy", { boxId: "b1", reason: "ttl" });

    const lines = (await readFile(path, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { timestamp: "2026-10-19T10:00:00.000Z", event: "daemon_start", port: 3210 },
      { timestamp: "2026-10-19T10:00:00.000Z", event: "box.destroy", boxId: "b1", reason: "ttl" },
    ]);
  });

  it("reports a failed write to the console without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocker = join(await mkdtemp(join(tmpdir(), "sandboxd-log-")), "not-a-dir");
    await writeFile(blocker, "");

    await expect(createEventLog(join(blocker, "x.jsonl"))("daemon_start")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
