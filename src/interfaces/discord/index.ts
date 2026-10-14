import { Client, Events, GatewayIntentBits } from "discord.js";
import { readDiscordConfig } from "./config";
import { createMessageHandler } from "./bot";

async function main() {
  const config = readDiscordConfig();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (ready) => {
    console.log(`Discord bot ready as ${ready.user.tag}`);
  });
  client.on(Events.MessageCreate, createMessageHandler(client, config));

  await client.login(config.token);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
