import { ThreadAutoArchiveDuration, type Client, type Message, type ThreadChannel } from "discord.js";
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
  // other rather than interleaving API calls and replies.
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
  // The thread-membership lookup is a network call; only pay for it once the
  // author gates that decideAction checks first have passed.
  const isMember =
    inThread && !message.author.bot && message.author.id === config.allowedUserId
      ? await isBotThreadMember(channel, botId)
      : false;
  const action = decideAction({
    isBot: message.author.bot,
    isAllowed: message.author.id === config.allowedUserId,
    isThread: inThread,
    isMember,
    mentionsBot: botId ? message.mentions.has(botId) : false,
  });

  let thread: ThreadChannel | null = null;
  if (action === "handle" && inThread) thread = channel;
  else if (action === "join" && inThread) {
    await channel.join();
    thread = channel;
  } else if (action === "spawn") {
    thread = await message.startThread({
      name: threadName(message, botId),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    });
  }
  if (!thread) return;

  const previous = queues.get(thread.id) ?? Promise.resolve();
  // `previous` is always a stored .catch()-ed promise, so it never rejects.
  const next = previous.then(() => handleMessage(client, config, message, thread));
  const stored = next.catch((error) => {
    console.error("Failed to handle a thread message", error);
  });
  queues.set(thread.id, stored);
  // Drop the entry once it settles and nothing has queued behind it.
  void stored.then(() => {
    if (queues.get(thread.id) === stored) queues.delete(thread.id);
  });
}

function isBotThreadMember(channel: ThreadChannel, botId: string): Promise<boolean> {
  // No force option: the first fetch hits the API, later ones hit the cache.
  return channel.members
    .fetchMe()
    .then((member) => member.user?.id === botId)
    .catch(() => false);
}

function threadName(message: Message, botId: string): string {
  const text = stripBotMention(message.content, botId).trim();
  return text ? text.slice(0, THREAD_NAME_MAX) : "chat";
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
  // honest "can't read it" reply instead of silently reaching the model.
  if (!text) {
    await thread.send(CANT_READ_MESSAGE);
    return;
  }

  // Discord's typing indicator expires, so repeat it while the API call runs.
  const typing = setInterval(() => void thread.sendTyping().catch(() => {}), TYPING_INTERVAL_MS);
  void thread.sendTyping().catch(() => {});
  let reply: string;
  try {
    const recent = await fetchRecentMessages(thread, config.historyLimit);
    // On a just-spawned thread the starter message may not appear in the
    // fetch yet; the trigger's own text is still the conversation seed.
    const history =
      buildThreadHistory(recent, {
        allowedUserId: config.allowedUserId,
        botUserId: botId,
        historyLimit: config.historyLimit,
      }) ?? [{ role: "user", content: text }];
    reply = await askSpekter(config.apiUrl, history);
  } catch (error) {
    console.error("Failed to answer a thread message", error);
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
    const pageSize = Math.min(100, limit - collected.length);
    const batch = await thread.messages.fetch({ limit: pageSize, before });
    if (!batch.size) break;
    for (const message of batch.values()) {
      collected.push({
        content: message.content,
        author: { id: message.author.id, bot: message.author.bot },
      });
    }
    before = batch.last()?.id;
    if (batch.size < pageSize) break;
  }
  return collected;
}
