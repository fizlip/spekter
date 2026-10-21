"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getSession } from "@/interfaces/web/session-client";
import { restoreMessages } from "@/interfaces/web/session";
import { ChatInterface } from "./ChatInterface";
import type { ChatMessage } from "./types";

const INITIAL_CHAT_ID = "initial";

type ChatSession = {
  chatId: string;
  restored: ChatMessage[] | null;
  newChat: () => void;
  openSession: (id: string) => Promise<void>;
  sessionsVersion: number;
  touchSessions: () => void;
};

const ChatSessionContext = createContext<ChatSession | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [chatId, setChatId] = useState(INITIAL_CHAT_ID);
  const [restored, setRestored] = useState<ChatMessage[] | null>(null);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const newChat = useCallback(() => {
    setRestored(null);
    setChatId(crypto.randomUUID());
  }, []);
  const openSession = useCallback(async (id: string) => {
    const session = await getSession(id);
    if (!session) return;
    setRestored(restoreMessages(session));
    setChatId(session.id);
  }, []);
  const touchSessions = useCallback(() => setSessionsVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ chatId, restored, newChat, openSession, sessionsVersion, touchSessions }),
    [chatId, restored, newChat, openSession, sessionsVersion, touchSessions],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export function useChatSession() {
  const session = useContext(ChatSessionContext);
  if (!session) throw new Error("useChatSession must be used within a ChatSessionProvider.");
  return session;
}

// Keying on the chat id remounts ChatInterface for every new chat, which resets all of its
// state and aborts any reply still streaming. Only the first chat shows the seeded messages;
// a restored session remounts with its stored transcript. The chat id is also the session
// file's id, so a continued session writes back to the same file.
export function ActiveChat({ initialMessages, todayKey, model }: { initialMessages: ChatMessage[]; todayKey: string; model: string | null }) {
  const { chatId, restored, newChat, touchSessions } = useChatSession();
  const sessionId = useMemo(
    () => (chatId === INITIAL_CHAT_ID ? crypto.randomUUID() : chatId),
    [chatId],
  );

  return (
    <ChatInterface
      initialMessages={chatId === INITIAL_CHAT_ID ? initialMessages : (restored ?? [])}
      key={chatId}
      todayKey={todayKey}
      model={model}
      sessionId={sessionId}
      onNewSession={newChat}
      onSessionSaved={touchSessions}
    />
  );
}
