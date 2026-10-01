import { ChatInterface } from "@/components/chat/ChatInterface";
import { createInitialMessages } from "@/components/chat/chat-data";

export default function Home() {
  const now = new Date();

  return (
    <ChatInterface
      initialMessages={createInitialMessages(now)}
      todayKey={now.toISOString().slice(0, 10)}
    />
  );
}
