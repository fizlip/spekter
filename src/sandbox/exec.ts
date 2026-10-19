import type { ExecHandle } from "./backend/types";

// Per-stream capture budget. Install logs can run to megabytes; the daemon keeps the start and
// the end (where errors usually are) and says how much it dropped. The Spekter tool trims further.
export const MAX_CAPTURE_BYTES = 512 * 1024;

export type ExecOutcome = "exited" | "timeout" | "client_disconnect";

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: { stdout: boolean; stderr: boolean };
  durationMs: number;
  outcome: ExecOutcome;
};

// Keeps the first and last half of the budget; everything in between is counted, not stored.
async function capture(stream: AsyncIterable<Buffer | string>): Promise<{ text: string; truncated: boolean }> {
  const half = MAX_CAPTURE_BYTES / 2;
  const head: Buffer[] = [];
  let headBytes = 0;
  let tail = Buffer.alloc(0);
  let total = 0;

  for await (const chunk of stream) {
    let buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (headBytes < half) {
      const take = buffer.subarray(0, half - headBytes);
      head.push(take);
      headBytes += take.length;
      buffer = buffer.subarray(take.length);
    }
    if (buffer.length) {
      tail = Buffer.concat([tail, buffer]);
      if (tail.length > half) tail = tail.subarray(tail.length - half);
    }
  }

  const truncated = total > MAX_CAPTURE_BYTES;
  const marker = truncated ? `\n[... ${total - MAX_CAPTURE_BYTES} bytes omitted ...]\n` : "";
  return { text: Buffer.concat(head).toString("utf-8") + marker + tail.toString("utf-8"), truncated };
}

// Waits for a command to exit, kill it on timeout (returning what it printed so far), or kill
// it when the caller disconnects — a dropped connection must never leave a command running.
export async function runCommand(handle: ExecHandle, { timeoutMs, signal }: { timeoutMs: number; signal: AbortSignal }): Promise<ExecResult> {
  const startedAt = Date.now();
  const output = Promise.all([capture(handle.stdout), capture(handle.stderr)]);
  let outcome = "exited" as ExecOutcome;

  const stop = (reason: ExecOutcome) => {
    if (outcome !== "exited") return;
    outcome = reason;
    void handle.kill().catch((error) => console.error("Failed to kill sandboxed command", error));
  };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const onAbort = () => stop("client_disconnect");
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    const exitCode = await handle.exited;
    const [stdout, stderr] = await output;
    return {
      exitCode: outcome === "exited" ? exitCode : null,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut: outcome === "timeout",
      truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
      durationMs: Date.now() - startedAt,
      outcome,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
