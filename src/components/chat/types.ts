export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  // Set only on an assistant reply that is still arriving or that failed.
  status?: "streaming" | "error";
  error?: string;
};
