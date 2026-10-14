import type { Source } from "@/core/chat/contract";

export type ChatMessage = {
  id: string;
  role: "assistant" | "reasoning" | "source" | "tool" | "user";
  content: string;
  createdAt: string;
  // Set only on a message that is still arriving or that failed.
  status?: "streaming" | "error";
  error?: string;
  // Set on a source message: the external inputs that went into the reply.
  sources?: Source[];
  // Set on a tool message: one tool call the model made for the reply. `path` is
  // set when the call's input names a file (the file tools), for display.
  tool?: { id: string; name: string; state: "running" | "succeeded" | "failed"; path?: string };
};
