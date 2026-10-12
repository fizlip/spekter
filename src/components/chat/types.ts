export type ChatMessage = {
  id: string;
  role: "assistant" | "reasoning" | "user";
  content: string;
  createdAt: string;
  // Set only on a message that is still arriving or that failed.
  status?: "streaming" | "error";
  error?: string;
};
