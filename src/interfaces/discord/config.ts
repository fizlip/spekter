import { readPositiveIntEnv, requireEnvVars, type Env } from "@/core/config";

export type DiscordConfig = {
  token: string;
  allowedUserId: string;
  apiUrl: string;
  historyLimit: number;
};

export const DEFAULT_API_URL = "http://127.0.0.1:3000";
export const DEFAULT_HISTORY_LIMIT = 50;

export function readDiscordConfig(env: Env = process.env): DiscordConfig {
  const { DISCORD_BOT_TOKEN: token, DISCORD_ALLOWED_USER_ID: allowedUserId } = requireEnvVars(env, [
    "DISCORD_BOT_TOKEN",
    "DISCORD_ALLOWED_USER_ID",
  ]);

  return {
    token,
    allowedUserId,
    apiUrl: env.SPEKTER_API_URL?.trim() || DEFAULT_API_URL,
    historyLimit: readPositiveIntEnv(env, "DISCORD_HISTORY_LIMIT", DEFAULT_HISTORY_LIMIT),
  };
}
