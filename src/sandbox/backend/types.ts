// The seam between sandboxd and the substrate that runs boxes. Lima is the v1 implementation;
// any backend that satisfies this shape swaps in without consumer changes.

export type InstanceStatus = "running" | "stopped" | "broken";

export type Instance = { id: string; status: InstanceStatus };

export type BoxSpec = {
  id: string;
  // Absolute host directory mounted into the guest at /workspace — the only host path it sees.
  workspaceDir: string;
};

export type Backend = {
  // Resolves once the box is ready to exec into; rejects when it failed to start.
  create(box: BoxSpec): Promise<void>;
  // Force-removes the box; resolves when it is gone (also when it was already gone).
  destroy(id: string): Promise<void>;
  // Every box this backend manages, including ones from before a daemon restart.
  list(): Promise<Instance[]>;
};
