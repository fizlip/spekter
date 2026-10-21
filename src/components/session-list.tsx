"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { listSessions } from "@/interfaces/web/session-client";
import type { SessionSummary } from "@/interfaces/web/session";
import { useChatSession } from "./chat/chat-session";

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Past sessions under the sidebar's "Sessions" entry; opening one restores its
// transcript through the session provider.
export function SessionList() {
  const { chatId, openSession, sessionsVersion } = useChatSession();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
  }, [chatId, sessionsVersion]);

  if (sessions.length === 0) {
    return <p className="px-2 py-1 font-inter text-xs text-gray-400">No sessions yet</p>;
  }

  return (
    <ul className="max-h-64 overflow-y-auto">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            onClick={() => void openSession(session.id)}
            title={session.title}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-inter text-sm hover:bg-[#e1e1e2] ${
              session.id === chatId ? "text-black" : "text-gray-500 hover:text-black"
            }`}
          >
            <MessageCircle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            <span className="shrink-0 text-xs text-gray-400">{relativeTime(session.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
