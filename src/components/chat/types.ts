import type { Source } from "@/core/chat/contract";

export type ChatMessage = {
  id: string;
  role: "assistant" | "reasoning" | "source" | "user";
  content: string;
  createdAt: string;
  // Set only on a message that is still arriving or that failed.
  status?: "streaming" | "error";
  error?: string;
  // Set on a source message: the external inputs that went into the reply.
  sources?: Source[];
};
