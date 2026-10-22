import { PassThrough } from "node:stream";
import type { Backend, ExecHandle, ExecRequest, InstanceStatus } from "./types";

type Hook = (id: string) => Promise<void>;

// A scripted command: write to stdout/stderr, then exit(code) — or never exit, and the
// daemon's timeout or disconnect path has to kill it.
export type FakeProcess = {
  stdout: PassThrough;
  stderr: PassThrough;
  exit(code: number | null): void;
};

function fakeProcess(onKill: () => void): { process: FakeProcess; handle: ExecHandle } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => (resolveExit = resolve));
  const exit = (code: number | null) => {
    stdout.end();
    stderr.end();
    resolveExit(code);
  };
  return {
    process: { stdout, stderr, exit },
    handle: {
      stdout,
      stderr,
      exited,
      kill: async () => {
        onKill();
        exit(null);
      },
    },
  };
}

// In-memory backend for tests: records calls, and hooks let a test fail, hold, or script an operation.
export function createFakeBackend() {
  const instances = new Map<string, InstanceStatus>();
  const calls: string[] = [];
  const hooks: {
    create?: Hook;
    destroy?: Hook;
    exec?: (process: FakeProcess, request: ExecRequest) => void;
  } = {};

  const backend: Backend = {
    async create({ id }) {
      calls.push(`create ${id}`);
      await hooks.create?.(id);
      instances.set(id, "running");
    },
    async destroy(id) {
      calls.push(`destroy ${id}`);
      await hooks.destroy?.(id);
      instances.delete(id);
    },
    async list() {
      return [...instances].map(([id, status]) => ({ id, status }));
    },
    exec(id, request) {
      calls.push(`exec ${id} ${request.cmd}`);
      const { process, handle } = fakeProcess(() => calls.push(`kill ${id}`));
      if (hooks.exec) hooks.exec(process, request);
      else process.exit(0);
      return handle;
    },
  };

  return { backend, instances, calls, hooks };
}
