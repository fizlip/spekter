import { readSandboxConfig } from "./config";
import { createEventLog } from "./log";
import { createHandler, serve } from "./server";

async function main() {
  const config = readSandboxConfig();
  const log = createEventLog(config.logPath);
  await serve(createHandler({ token: config.token, routes: [] }), config.port);
  await log("daemon_start", { port: config.port });
  console.log(`sandboxd listening on http://127.0.0.1:${config.port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
