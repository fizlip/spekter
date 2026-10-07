import { describe, expect, it } from "vitest";
import { serializeFrame, type ChatStreamFrame } from "./stream-frames";

describe("serializeFrame", () => {
  it.each<ChatStreamFrame>([
    { type: "delta", text: "Hello\nworld" },
    { type: "error", code: "provider_error", message: "Rate limit exceeded" },
    { type: "done", model: "anthropic/claude-haiku-4.5" },
  ])("writes $type as one line of JSON that parses back to the same frame", (frame) => {
    const line = serializeFrame(frame);

    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(frame);
  });
});
