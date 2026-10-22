// The seam between sandboxd and the substrate that runs boxes. Lima is the v1 implementation;
// any backend that satisfies this shape swaps in without consumer changes.

export type InstanceStatus = "running" | "stopped" | "broken";

export type Instance = { id: string; status: InstanceStatus };

export type BoxSpec = {
  id: string;
  // Absolute host directory mounted into the guest at /workspace — the only host path it sees.
  workspaceDir: string;
};

export type ExecRequest = {
  // Shell text, interpreted inside the guest only — never by a host shell.
  cmd: string;
  // Guest working directory.
  workdir: string;
};

// A command running in a box. The daemon reads both streams to the end, waits on exited,
// and calls kill on timeout or client disconnect; kill must stop the command inside the guest.
export type ExecHandle = {
  stdout: AsyncIterable<Buffer | string>;
  stderr: AsyncIterable<Buffer | string>;
  // The guest exit code, or null when the command was killed.
  exited: Promise<number | null>;
  kill(): Promise<void>;
};

export type Backend = {
  // Resolves once the box is ready to exec into; rejects when it failed to start.
  create(box: BoxSpec): Promise<void>;
  // Force-removes the box; resolves when it is gone (also when it was already gone).
  destroy(id: string): Promise<void>;
  // Every box this backend manages, including ones from before a daemon restart.
  list(): Promise<Instance[]>;
  exec(id: string, request: ExecRequest): ExecHandle;
};
