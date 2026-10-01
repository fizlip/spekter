import { NotConfiguredError } from "./errors";

export type Config = {
  apiKey: string;
  model: string;
};

type Env = Record<string, string | undefined>;

export function readConfig(env: Env = process.env): Config {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const model = env.SPEKTER_MODEL?.trim();
  const missing = [
    !apiKey && "OPENROUTER_API_KEY",
    !model && "SPEKTER_MODEL",
  ].filter(Boolean);

  if (!apiKey || !model) {
    const label = missing.length > 1 ? "variables" : "variable";
    throw new NotConfiguredError(`Missing environment ${label}: ${missing.join(", ")}`);
  }

  return { apiKey, model };
}
