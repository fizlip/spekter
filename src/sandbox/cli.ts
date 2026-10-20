import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildGoldenImage, type BuildOptions } from "./backend/image";
import { DEFAULT_IMAGE } from "./backend/lima-yaml";
import { createSandboxClient, type ExecResponse } from "./client";
import { DEFAULT_PORT, readSandboxConfig, type Env } from "./config";
import type { BoxInfo } from "./boxes";

const USAGE = `Usage:
  sandbox image build
  sandbox create [--name <id>] [--ttl <seconds>] [--json]
  sandbox exec <box> [--timeout <seconds>] [--workdir <dir>] [--json] [--] <command...>
  sandbox list [--json]
  sandbox inspect <box> [--json]
  sandbox destroy <box> [--json]
`;

const VALUE_FLAGS = ["--name", "--ttl", "--timeout", "--workdir"] as const;
type Flag = (typeof VALUE_FLAGS)[number];

class UsageError extends Error {}

type Parsed = { positionals: string[]; flags: Partial<Record<Flag, string>>; json: boolean; rest?: string[] };

// Flags go anywhere before the command. For `exec`, the second positional starts the command
// (or `--` does), and everything from there on is passed through verbatim, flags included.
function parse(args: string[], commandAfter?: number): Parsed {
  const parsed: Parsed = { positionals: [], flags: {}, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") parsed.json = true;
    else if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      if (i + 1 >= args.length) throw new UsageError(`${arg} needs a value`);
      parsed.flags[arg as Flag] = args[++i];
    } else if (arg === "--" || (commandAfter !== undefined && parsed.positionals.length === commandAfter)) {
      parsed.rest = args.slice(arg === "--" ? i + 1 : i);
      break;
    } else if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
    else parsed.positionals.push(arg);
  }
  return parsed;
}

function seconds(flag: Flag, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`${flag} must be a positive whole number of seconds`);
  return parsed;
}

function oneBox({ positionals }: Parsed): string {
  if (positionals.length !== 1) throw new UsageError("Expected exactly one box id");
  return positionals[0];
}

const describeBox = (box: BoxInfo) =>
  `${box.id}\t${box.state}\tttl ${box.ttlSeconds}s\tlast active ${box.lastActiveAt}\t${box.workspaceDir}\n`;

export type CliIo = {
  env: Env;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  signal?: AbortSignal;
  buildImage?: (options: BuildOptions) => Promise<void>;
};

// Returns the process exit code: the command's own for exec, 124 on timeout, 1 on errors, 2 on misuse.
export async function runCli(argv: string[], { env, stdout, stderr, signal, buildImage = buildGoldenImage }: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    const token = env.SANDBOX_TOKEN?.trim();
    if (!token) {
      stderr("Missing SANDBOX_TOKEN (generate one with `openssl rand -hex 32` and put it in .env.local)\n");
      return 1;
    }
    const client = createSandboxClient({ url: `http://127.0.0.1:${env.SANDBOX_PORT?.trim() || DEFAULT_PORT}`, token });
    const print = (json: boolean, data: unknown, human: string) => stdout(json ? `${JSON.stringify(data, null, 2)}\n` : human);

    switch (command) {
      case "image": {
        if (args.length !== 1 || args[0] !== "build") throw new UsageError("Expected `sandbox image build`");
        // Runs here rather than in sandboxd: a build takes minutes. Boxes created meanwhile
        // fall back to a cold boot, since only a stopped golden instance is cloned.
        const config = readSandboxConfig(env);
        const startedAt = Date.now();
        await buildImage({
          limaHome: config.limaHome,
          configDir: join(config.sandboxDir, "configs"),
          image: DEFAULT_IMAGE,
          caps: config.caps,
          env,
          progress: (message) => stdout(`${message}...\n`),
        });
        stdout(`Golden image ready in ${Math.round((Date.now() - startedAt) / 1000)}s; new boxes clone from it.\n`);
        return 0;
      }
      case "create": {
        const parsed = parse(args);
        if (parsed.positionals.length) throw new UsageError("create takes no positional arguments");
        const box = await client.create({ name: parsed.flags["--name"], ttlSeconds: seconds("--ttl", parsed.flags["--ttl"]) }, signal);
        print(parsed.json, box, describeBox(box));
        return 0;
      }
      case "exec": {
        const parsed = parse(args, 1);
        const id = oneBox(parsed);
        const cmd = parsed.rest?.join(" ").trim();
        if (!cmd) throw new UsageError("exec needs a command");
        const result: ExecResponse = await client.exec(
          id,
          { cmd, workdir: parsed.flags["--workdir"], timeoutSeconds: seconds("--timeout", parsed.flags["--timeout"]) },
          signal,
        );
        if (parsed.json) stdout(`${JSON.stringify(result, null, 2)}\n`);
        else {
          stdout(result.stdout);
          stderr(result.stderr);
          if (result.timedOut) stderr(`[sandbox] command timed out after ${Math.round(result.durationMs / 1000)}s\n`);
          for (const stream of ["stdout", "stderr"] as const) {
            if (result.truncated[stream]) stderr(`[sandbox] ${stream} truncated (middle of the output dropped)\n`);
          }
        }
        return result.timedOut ? 124 : (result.exitCode ?? 1);
      }
      case "list": {
        const parsed = parse(args);
        const { boxes } = await client.list(signal);
        print(parsed.json, { boxes }, boxes.length ? boxes.map(describeBox).join("") : "No boxes.\n");
        return 0;
      }
      case "inspect": {
        const parsed = parse(args);
        const box = await client.inspect(oneBox(parsed), signal);
        print(parsed.json, box, describeBox(box));
        return 0;
      }
      case "destroy": {
        const parsed = parse(args);
        const result = await client.destroy(oneBox(parsed), signal);
        print(parsed.json, result, `Destroyed ${result.id} (its workspace is kept)\n`);
        return 0;
      }
      default:
        throw new UsageError(command ? `Unknown command "${command}"` : "Missing command");
    }
  } catch (error) {
    if (error instanceof UsageError) {
      stderr(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    stderr(`sandbox: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Ctrl-C drops the HTTP call; the daemon sees the disconnect and kills the command in the guest.
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  runCli(process.argv.slice(2), {
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: controller.signal,
  }).then((code) => {
    process.exitCode = controller.signal.aborted ? 130 : code;
  });
}
