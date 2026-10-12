import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NotConfiguredError } from "../errors";
import { COMMANDS, type Command } from "./commands.meta";
import type { ChatMessage, Source } from "./contract";
import type { ChatStreamFrame } from "./stream-frames";

// A command token must start the message or follow whitespace, so paths and URLs
// like "docs/help/HELP.md" never match. Unregistered /tokens pass through as text.
export function parseCommands(content: string): { commands: Command[]; text: string } {
  const commands: Command[] = [];
  const text = content
    .replace(/(^|\s)\/([\w-]+)/g, (match, lead: string, name: string) => {
      const command = COMMANDS.find((c) => c.name === name);
      if (!command) return match;
      commands.push(command);
      return lead;
    })
    .replace(/[ \t]+/g, " ")
    .trim();
  return { commands, text };
}

// A configured file that cannot be read is a configuration error, never a silent drop.
export async function readCommandFile(file: string): Promise<string> {
  const path = resolve(file);
  try {
    return await readFile(path, "utf-8");
  } catch {
    throw new NotConfiguredError(`Cannot read command file: ${path}`);
  }
}

// The prompt fragments context commands contribute, in the order they appear.
export async function commandContextTexts(commands: Command[]): Promise<string[]> {
  const contexts = commands.filter((command) => command.kind === "context");
  return Promise.all(
    contexts.map(async (command) => (command.file ? readCommandFile(command.file) : (command.text ?? ""))),
  );
}

export async function* commandReplyFrames(text: string, sources: Source[] = []): AsyncGenerator<ChatStreamFrame> {
  if (sources.length > 0) yield { type: "sources", sources };
  yield { type: "delta", text };
  yield { type: "done", model: "spekter", sources };
}

// Resolves every command in the last user message into the pieces a route needs:
// reply takes over the whole turn; the rest merge into the call's context and options.
// Command tokens leave only whitespace behind -> the original text is kept, so the
// model still gets a nonempty user message.
export async function resolveCommands(messages: ChatMessage[]): Promise<{
  reply: string | null;
  contextTexts: string[];
  sources: Source[];
  effort: "medium" | "none" | undefined;
  model: string | undefined;
  messages: ChatMessage[];
}> {
  const last = messages.at(-1);
  const { commands, text } = last ? parseCommands(last.content) : { commands: [], text: "" };

  const replyCommand = commands.find((command) => command.kind === "reply");
  const reply = replyCommand?.kind === "reply" ? await readCommandFile(replyCommand.file) : null;

  const options = commands.filter((command) => command.kind === "options").at(-1);
  const resolved = options?.kind === "options" ? options : undefined;

  // Every file a command pulls in is a source, so the reply can show what was read.
  const files = commands.flatMap((command) => {
    if (command.kind === "reply") return [command.file];
    if (command.kind === "context" && command.file) return [command.file];
    return [];
  });

  return {
    reply,
    contextTexts: await commandContextTexts(commands),
    sources: files.map((path) => ({ type: "command_file", path })),
    effort: resolved?.effort,
    model: resolved?.model,
    messages: text && last ? [...messages.slice(0, -1), { ...last, content: text }] : messages,
  };
}
