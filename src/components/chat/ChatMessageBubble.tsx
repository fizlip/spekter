import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatMessage } from "./types";

function formatTime(createdAt: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(createdAt));
}

export function getDayKey(createdAt: string) {
  return createdAt.slice(0, 10);
}

export function formatDayLabel(dayKey: string, todayKey: string) {
  const day = new Date(`${dayKey}T00:00:00.000Z`);
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const difference = Math.round((today.getTime() - day.getTime()) / 86_400_000);

  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(day);
}

function MessageTimestamp({
  createdAt,
  alignment,
}: {
  createdAt: string;
  alignment: "left" | "right";
}) {
  return (
    <time
      className={`mt-1.5 px-1 text-[11px] tabular-nums text-slate-400 ${alignment === "left" ? "text-left" : "text-right"}`}
      dateTime={createdAt}
    >
      {formatTime(createdAt)}
    </time>
  );
}

export function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <article
      aria-label={`Spekter at ${formatTime(message.createdAt)}`}
      className="flex items-start gap-2 justify-start hover:bg-slate-50 px-2"
    >
      <Avatar className="mt-1 after:hidden">
        <AvatarImage src="/afryend.jpg" alt="Spekter" />
        <AvatarFallback>SP</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <p className="font-bold font-gg-sans text-green-700">afryend</p>
        <div className="rounded whitespace-pre-wrap break-words text-[16px] leading-[1.55] text-slate-800">
          {message.content ||
            (message.status === "streaming" && (
              <span aria-label="Spekter is replying" className="animate-pulse text-slate-400">
                …
              </span>
            ))}
        </div>
        {message.status === "error" && (
          <p
            className="mx-1 mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[13px] text-red-700"
            role="alert"
          >
            Reply failed: {message.error}
          </p>
        )}
      </div>
    </article>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article
      aria-label={`You at ${formatTime(message.createdAt)}`}
      className="flex items-start gap-2 justify-start hover:bg-slate-50 px-2"
    >
      <Avatar className="mt-1">
        <AvatarImage src="https://github.com/evilrabbit.png" alt="You" />
        <AvatarFallback>ME</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <p className="font-bold font-gg-sans">Filip Zlatoidsky</p>
        <div className="rounded whitespace-pre-wrap break-words text-[16px] leading-[1.55] text-slate-800">
          {message.content}
        </div>
      </div>
    </article>
  );
}
