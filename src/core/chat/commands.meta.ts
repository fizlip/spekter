// Slash command manifest — pure data, safe to import from client components.
// Server-only resolution (file reads, parsing, dispatch) lives in commands.ts.
//
// Slash commands are message-scoped: every registered /token in the last user
// message applies to that one request, then is stripped before the model sees it.
export type Command =
  | { kind: "reply"; name: string; description: string; file: string }
  | { kind: "context"; name: string; description: string; file?: string; text?: string }
  | { kind: "options"; name: string; description: string; effort?: "medium" | "none"; model?: string };

export const COMMANDS: Command[] = [
  { kind: "reply", name: "help", description: "Show available commands", file: "docs/help/HELP.md" },
  { kind: "options", name: "fast", description: "Use the current model with the least reasoning", effort: "none" },
  { kind: "options", name: "smart", description: "Use the current model with the most reasoning", effort: "medium" },
  {
    kind: "context",
    name: "plan",
    description: "Switch to plan mode",
    text: "Respond with a plan only: outline the steps you would take without carrying them out.",
  },
  {
    kind: "context",
    name: "recap",
    description: "Recap the session so far",
    text: "Summarize the conversation so far.",
  },
  {
    kind: "context",
    name: "sales-prep",
    description: "Prepare notes and talking points for a sales call",
    file: "skills/sales-prep/SKILL.md",
  },
];
