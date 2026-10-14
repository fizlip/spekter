import { NotConfiguredError } from "@/core/errors";
import type { Env } from "@/core/config";

export type DiscordConfig = {
  token: string;
  allowedUserId: string;
  apiUrl: string;
  historyLimit: number;
};

export const DEFAULT_API_URL = "http://127.0.0.1:3000";
export const DEFAULT_HISTORY_LIMIT = 50;

export function readDiscordConfig(env: Env = process.env): DiscordConfig {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const allowedUserId = env.DISCORD_ALLOWED_USER_ID?.trim();
  const missing = [
    !token && "DISCORD_BOT_TOKEN",
    !allowedUserId && "DISCORD_ALLOWED_USER_ID",
  ].filter(Boolean);

  if (!token || !allowedUserId) {
    const label = missing.length > 1 ? "variables" : "variable";
    throw new NotConfiguredError(`Missing environment ${label}: ${missing.join(", ")}`);
  }

  const historyValue = env.DISCORD_HISTORY_LIMIT?.trim();
  let historyLimit = DEFAULT_HISTORY_LIMIT;
  if (historyValue) {
    if (!/^\d+$/.test(historyValue) || Number(historyValue) < 1) {
      throw new NotConfiguredError(
        `DISCORD_HISTORY_LIMIT must be a positive whole number, got "${historyValue}"`,
      );
    }
    historyLimit = Number(historyValue);
  }

  return {
    token,
    allowedUserId,
    apiUrl: env.SPEKTER_API_URL?.trim() || DEFAULT_API_URL,
    historyLimit,
  };
}
