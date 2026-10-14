import type { Client, Message, ThreadChannel } from "discord.js";
import type { DiscordConfig } from "./config";
import { splitForDiscord } from "./format";
import { askSpekter } from "./spekter-api";
import { buildThreadHistory, stripBotMention, type ThreadMessage } from "./history";

const CANT_READ_MESSAGE =
  "I can't read that — send it as text. Attachments, stickers, and embeds aren't supported.";
const BROKEN_MESSAGE = "Something broke while answering.";
const TYPING_INTERVAL_MS = 8_000;
const THREAD_NAME_MAX = 90;

export type Action = "ignore" | "handle" | "join" | "spawn";

// The gating rules from the plan, kept pure so they're testable without a gateway.
export function decideAction(args: {
  isBot: boolean;
  isAllowed: boolean;
  isThread: boolean;
  isMember: boolean;
  mentionsBot: boolean;
}): Action {
  if (args.isBot || !args.isAllowed) return "ignore";
  if (args.isThread) {
    if (args.isMember) return "handle";
    return args.mentionsBot ? "join" : "ignore";
  }
  return args.mentionsBot ? "spawn" : "ignore";
}

export function createMessageHandler(client: Client, config: DiscordConfig) {
  // One outstanding handling run per thread: rapid messages queue behind each
  // other rather than interleaving API calls and replies (KTD4).
  const queues = new Map<string, Promise<void>>();

  return (message: Message) => {
    void dispatch(client, config, queues, message).catch((error) => {
      console.error("Failed to dispatch a message", error);
    });
  };
}

async function dispatch(
  client: Client,
  config: DiscordConfig,
  queues: Map<string, Promise<void>>,
  message: Message,
): Promise<void> {
  const botId = client.user?.id ?? "";
  const channel = message.channel;
  const inThread = channel.isThread();
  const isMember = inThread ? await isBotThreadMember(channel, botId) : false;
  const action = decideAction({
    isBot: message.author.bot,
    isAllowed: message.author.id === config.allowedUserId,
    isThread: inThread,
    isMember,
    mentionsBot: botId ? message.mentions.has(botId) : false,
  });

  let thread: ThreadChannel | null = null;
  if (action === "handle") thread = channel as ThreadChannel;
  else if (action === "join") {
    await (channel as ThreadChannel).join();
    thread = channel as ThreadChannel;
  } else if (action === "spawn") {
    thread = await message.startThread({
      name: threadName(message, botId),
      autoArchiveDuration: 60,
    });
  }
  if (!thread) return;

  const previous = queues.get(thread.id) ?? Promise.resolve();
  const next = previous.then(
    () => handleMessage(client, config, message, thread),
    () => handleMessage(client, config, message, thread),
  );
  queues.set(
    thread.id,
    next.catch(() => {}),
  );
}

function isBotThreadMember(channel: ThreadChannel, botId: string): Promise<boolean> {
  return channel.members
    .fetchMe({ cache: false })
    .then((member) => member?.user?.id === botId)
    .catch(() => false);
}

function threadName(message: Message, botId: string): string {
  const text = stripBotMention(message.content, botId).trim();
  const name = text ? text.slice(0, THREAD_NAME_MAX) : "chat";
  return name;
}

async function handleMessage(
  client: Client,
  config: DiscordConfig,
  message: Message,
  thread: ThreadChannel,
): Promise<void> {
  const botId = client.user?.id ?? "";
  const text = stripBotMention(message.content, botId).trim();

  // A message with no usable text (attachment-only, sticker, embed) gets an
  // honest "can't read it" reply instead of silently reaching the model (R10).
  if (!text) {
    await thread.send(CANT_READ_MESSAGE);
    return;
  }

  const typing = setInterval(() => void thread.sendTyping().catch(() => {}), TYPING_INTERVAL_MS);
  void thread.sendTyping().catch(() => {});
  let reply: string;
  try {
    const recent = await fetchRecentMessages(thread, config.historyLimit);
    const history = buildThreadHistory(recent, botId, config.allowedUserId, config.historyLimit);
    reply = history ? await askSpekter(config.apiUrl, history) : CANT_READ_MESSAGE;
  } catch {
    reply = BROKEN_MESSAGE;
  } finally {
    clearInterval(typing);
  }

  for (const chunk of splitForDiscord(reply)) {
    await thread.send(chunk);
  }
}

// Discord returns at most 100 messages per fetch and newest first; page until
// the configured bound is met or the thread runs out of history.
async function fetchRecentMessages(thread: ThreadChannel, limit: number): Promise<ThreadMessage[]> {
  const collected: ThreadMessage[] = [];
  let before: string | undefined;
  while (collected.length < limit) {
    const batch = await thread.messages.fetch({
      limit: Math.min(100, limit - collected.length),
      before,
    });
    if (!batch.size) break;
    for (const message of batch.values()) {
      collected.push({
        id: message.id,
        content: message.content,
        author: { id: message.author.id, bot: message.author.bot },
      });
    }
    before = batch.last()?.id;
    if (batch.size < Math.min(100, limit)) break;
  }
  return collected;
}
