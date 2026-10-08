import type { ErrorCode } from "../errors";

export type ChatStreamFrame =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "done"; model: string };

export const STREAM_CONTENT_TYPE = "application/x-ndjson";

export function serializeFrame(frame: ChatStreamFrame): string {
  return `${JSON.stringify(frame)}\n`;
}
