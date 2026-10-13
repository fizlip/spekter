import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentTime } from "./current-time";
import { builtinTools } from "./registry";

describe("current_time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T11:18:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns the current instant in ISO 8601 with the server's timezone", async () => {
    const result = await currentTime.execute({}, {});
    expect(result).toEqual({
      now: "2026-10-12T11:18:00.000Z",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(result.timeZone).not.toBe("");
  });

  it("accepts an empty input", () => {
    expect(currentTime.inputSchema.safeParse({}).success).toBe(true);
  });
});

describe("builtinTools", () => {
  it("registers current_time and nothing else", () => {
    expect(builtinTools.map((tool) => tool.name)).toEqual(["current_time"]);
    expect(builtinTools[0].description).not.toBe("");
  });
});
