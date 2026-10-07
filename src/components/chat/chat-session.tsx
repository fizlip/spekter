"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ChatInterface } from "./ChatInterface";
import type { ChatMessage } from "./types";

const INITIAL_CHAT_ID = "initial";

type ChatSession = {
  chatId: string;
  newChat: () => void;
};

const ChatSessionContext = createContext<ChatSession | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [chatId, setChatId] = useState(INITIAL_CHAT_ID);
  const newChat = useCallback(() => setChatId(crypto.randomUUID()), []);
  const value = useMemo(() => ({ chatId, newChat }), [chatId, newChat]);

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export function useChatSession() {
  const session = useContext(ChatSessionContext);
  if (!session) throw new Error("useChatSession must be used within a ChatSessionProvider.");
  return session;
}

// Keying on the chat id remounts ChatInterface for every new chat, which resets all of its
// state and aborts any reply still streaming. Only the first chat shows the seeded messages.
export function ActiveChat({ initialMessages, todayKey }: { initialMessages: ChatMessage[]; todayKey: string }) {
  const { chatId } = useChatSession();

  return (
    <ChatInterface
      initialMessages={chatId === INITIAL_CHAT_ID ? initialMessages : []}
      key={chatId}
      todayKey={todayKey}
    />
  );
}
