import { ActiveChat } from "@/components/chat/chat-session";
import { createInitialMessages } from "@/components/chat/chat-data";
import { readConfiguredModel } from "@/core/config";

export default function Home() {
  const now = new Date();

  return (
    <ActiveChat
      initialMessages={createInitialMessages(now)}
      todayKey={now.toISOString().slice(0, 10)}
      model={readConfiguredModel()}
    />
  );
}
