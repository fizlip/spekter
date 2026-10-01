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
      className="flex items-end gap-0 justify-start"
    >
      <div className="flex w-[100%] flex-col">
        <div className="rounded whitespace-pre-wrap break-words bg-white text-[16px] leading-[1.55] text-slate-800 hover:bg-slate-50 p-1">
          {message.content}
        </div>
      </div>
    </article>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article
      aria-label={`You at ${formatTime(message.createdAt)}`}
      className="flex items-end gap-0 justify-start"
    >
      <div className="flex w-[100%] flex-col">
        <div className="rounded whitespace-pre-wrap break-words bg-white text-[16px] leading-[1.55] text-slate-800 hover:bg-slate-50 p-1">
          {message.content}
        </div>
      </div>
    </article>
  );
}
