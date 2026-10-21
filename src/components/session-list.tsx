"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Triangle } from "lucide-react";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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

// Past sessions as an expandable sidebar group, shaped like the workspace tree:
// the list fetches only while open, and opening one restores its transcript
// through the session provider.
export function SessionList() {
  const { chatId, openSession, sessionsVersion } = useChatSession();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    listSessions().then(setSessions).catch(() => {});
  }, [open, chatId, sessionsVersion]);

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => setOpen((value) => !value)}
            className="flex m-auto font-semibold font-inter hover:bg-[#e1e1e2] cursor-pointer text-xs hover:text-black text-gray-500"
          >
            <p className="">Sessions</p>
            <Triangle
              fill="currentColor"
              className={`size-2! text-gray-500 transition-transform ${open ? "rotate-180" : "rotate-90"}`}
            />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5">
          {sessions.length === 0 ? (
            <p className="px-2 text-xs text-gray-400">No sessions yet</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void openSession(session.id)}
                title={session.title}
                className={`flex h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-[#e1e1e2] ${
                  session.id === chatId ? "text-gray-800" : "text-gray-500 hover:text-black"
                }`}
                style={{ paddingLeft: 8 }}
              >
                <MessageCircle size={12} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-gray-400">{relativeTime(session.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </SidebarGroup>
  );
}
