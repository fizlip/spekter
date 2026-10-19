import type { Backend, InstanceStatus } from "./types";

type Hook = (id: string) => Promise<void>;

// In-memory backend for tests: records calls, and hooks let a test fail or hold an operation.
export function createFakeBackend() {
  const instances = new Map<string, InstanceStatus>();
  const calls: string[] = [];
  const hooks: { create?: Hook; destroy?: Hook } = {};

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
  };

  return { backend, instances, calls, hooks };
}
