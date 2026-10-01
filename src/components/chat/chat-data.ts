import type { ChatMessage } from "./types";

export function createInitialMessages(now = new Date()): ChatMessage[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const timestamp = (dayOffset: number, hour: number, minute: number) =>
    new Date(today + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000).toISOString();

  return [
    {
      id: "message-1",
      role: "assistant",
      content: "Hi there! I’m Spekter. What’s on your mind today?",
      createdAt: timestamp(-1, 16, 18),
    },
    {
      id: "message-2",
      role: "user",
      content: "I’d love to plan a slower, more intentional week.",
      createdAt: timestamp(-1, 16, 20),
    },
    {
      id: "message-3",
      role: "assistant",
      content:
        "That sounds lovely. We can make space for the things that matter without overfilling your schedule. What are a few things you’d like to make time for?",
      createdAt: timestamp(-1, 16, 20),
    },
    {
      id: "message-4",
      role: "user",
      content: "A little movement, focused work, and a proper evening off.",
      createdAt: timestamp(0, 9, 41),
    },
    {
      id: "message-5",
      role: "assistant",
      content:
        "A good balance. Try protecting one focused block each morning, then keep movement small and easy to start—a walk or a short stretch counts. For your evening off, pick an end time for work now and let that be the boundary.\n\nWant to sketch out a simple day together?",
      createdAt: timestamp(0, 9, 42),
    },
  ];
}
