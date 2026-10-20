import { z } from "zod";
import type { Backend } from "./backend/types";
import { assertBoxId, type BoxRegistry } from "./boxes";
import { runCommand } from "./exec";
import type { EventLog } from "./log";
import { json, parseBody, type Route } from "./server";
import { SandboxError } from "./wire";

const createBody = z.object({
  name: z.string().optional(),
  ttlSeconds: z.number().int().positive().optional(),
});

const execBody = z.object({
  cmd: z.string().min(1),
  workdir: z.string().min(1).optional(),
  timeoutSeconds: z.number().int().positive().optional(),
});

export type RouteOptions = {
  boxes: BoxRegistry;
  backend: Backend;
  log: EventLog;
  // Default and ceiling for a command's run time, in seconds.
  exec: { defaultSeconds: number; maxSeconds: number };
};

export function boxRoutes({ boxes, backend, log, exec }: RouteOptions): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/boxes$/,
      handle: async (request) => json(await boxes.create(await parseBody(createBody, request)), 201),
    },
    { method: "GET", pattern: /^\/boxes$/, handle: async () => json({ boxes: boxes.list() }) },
    { method: "GET", pattern: /^\/boxes\/([^/]+)$/, handle: async (_request, [id]) => json(boxes.get(assertBoxId(id))) },
    {
      method: "DELETE",
      pattern: /^\/boxes\/([^/]+)$/,
      handle: async (_request, [id]) => {
        await boxes.destroy(assertBoxId(id));
        return json({ id, destroyed: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/boxes\/([^/]+)\/exec$/,
      handle: async (request, [id]) => {
        const { cmd, workdir = "/workspace", timeoutSeconds = exec.defaultSeconds } = await parseBody(execBody, request);
        if (timeoutSeconds > exec.maxSeconds) {
          throw new SandboxError("invalid_request", `timeoutSeconds must be at most ${exec.maxSeconds}`);
        }
        const { workspaceDir } = boxes.get(assertBoxId(id));
        const { outcome, ...result } = await boxes.runExec(id, () =>
          runCommand(backend.exec(id, { cmd, workdir }), { timeoutMs: timeoutSeconds * 1000, signal: request.signal }),
        );
        await log("exec", {
          boxId: id,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          truncated: result.truncated,
          outcome,
        });
        return json({ boxId: id, workspaceDir, ...result });
      },
    },
  ];
}
