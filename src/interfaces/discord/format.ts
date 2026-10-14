export const DISCORD_MESSAGE_LIMIT = 2000;

// Split a reply into Discord-sized chunks, preferring paragraph, then line,
// then word boundaries; an unbroken block is hard-split at the limit (KTD5).
export function splitForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (!text) return ["(empty reply)"];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut =
      lastBreak(window, "\n\n") ??
      lastBreak(window, "\n") ??
      lastBreak(window, " ") ??
      limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest);
  return chunks;
}

function lastBreak(window: string, boundary: string): number | null {
  const index = window.lastIndexOf(boundary);
  return index >= 1 ? index : null;
}
