import { join } from "node:path";
import { createFakeBackend } from "./backend/fake";
import { createBoxRegistry } from "./boxes";
import { readSandboxConfig } from "./config";
import { createEventLog } from "./log";
import { boxRoutes } from "./routes";
import { createHandler, serve } from "./server";

const REAP_INTERVAL_MS = 30_000;

async function main() {
  const config = readSandboxConfig();
  const log = createEventLog(config.logPath);
  const { backend } = createFakeBackend();
  const boxes = createBoxRegistry({
    backend,
    stateDir: join(config.sandboxDir, "boxes"),
    workspaceRoot: config.workspaceRoot,
    maxBoxes: config.maxBoxes,
    defaultTtlSeconds: config.ttlSeconds,
    log,
  });
  await boxes.reconcile();
  boxes.startReaper(REAP_INTERVAL_MS);
  const routes = boxRoutes({
    boxes,
    backend,
    log,
    exec: { defaultSeconds: config.execDefaultSeconds, maxSeconds: config.execMaxSeconds },
  });
  await serve(createHandler({ token: config.token, routes }), config.port);
  await log("daemon_start", { port: config.port });
  console.log(`sandboxd listening on http://127.0.0.1:${config.port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
