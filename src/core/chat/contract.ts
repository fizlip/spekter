import { z } from "zod";
import { InvalidRequestError } from "../errors";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().refine((content) => content.trim().length > 0, "Message content must not be empty"),
});

const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1, { message: "Conversation must contain at least one message", abort: true })
    .refine((messages) => messages.at(-1)?.role === "user", {
      message: "Conversation must end with a user message",
    }),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Something external that went into a reply; each kind of source gets its own `type`.
export type Source = { type: "knowledge_file"; path: string };

export type ChatResponse = {
  message: { role: "assistant"; content: string };
  model: string;
  sources: Source[];
};

export function parseChatRequest(body: unknown): ChatRequest {
  const result = chatRequestSchema.safeParse(body);
  if (!result.success) throw new InvalidRequestError(z.prettifyError(result.error));
  return result.data;
}
