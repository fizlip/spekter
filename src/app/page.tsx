import { ActiveChat } from "@/components/chat/chat-session";
import { readConfiguredModel } from "@/core/config";

export default function Home() {
  const now = new Date();

  return (
    <ActiveChat
      initialMessages={[]}
      todayKey={now.toISOString().slice(0, 10)}
      model={readConfiguredModel()}
    />
  );
}
