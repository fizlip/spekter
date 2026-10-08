import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { math } from "@streamdown/math";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import type { ChatMessage } from "./types";
import {useState, useEffect, useRef} from "react"
import {Brain} from "lucide-react"

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
  const [hideReasoning, setHideReasoning] = useState(false)
  const reasoningRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if(message.content){
      setHideReasoning(true)
    }
  }, [message.content])

  useEffect(() => {
    const el = reasoningRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [message.reasoning, hideReasoning])

  return (
    <article
      aria-label={`Spekter at ${formatTime(message.createdAt)}`}
      className="group relative flex items-start gap-2 justify-start hover:bg-slate-50 px-2"
    >
      <Avatar className="mt-1 after:hidden">
        <AvatarImage src="/afryend.jpg" alt="Spekter" />
        <AvatarFallback>SP</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <p className="font-bold font-gg-sans text-green-700">afryend</p>
        <div className="rounded break-words text-[16px] leading-[1.5] text-black">
          {message.reasoning && (
            <div
              ref={reasoningRef}
              className={hideReasoning ? "hidden" : message.content ? "block pl-4 my-4 border-l border-black/20" : `
                block max-h-[75px] overflow-auto py-2 my-2 leading-[1.25] pl-2
                [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                [mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%_-_8px),transparent)]
              `}
            >
              <div className="flex gap-2 items-center text-xs">
                <Brain size={12}/>
                <p>Thoughts</p>
              </div>
              <span className={message.content ? "text-xs" : "bg-gray-50 animate-pulse p-1 rounded-md text-slate-600 text-xs"}>
                {message.reasoning}
              </span>
            </div>
          )}
        {(message.content && <Streamdown plugins={{ math, code }} className="leading-[1.5]">{message.content}</Streamdown>) ||
          (message.status === "streaming" && (
            <span aria-label="Spekter is replying" className="flex items-center animate-pulse text-xs">
              Thinking…
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
      <div className="flex items-center group-hover:visible absolute -top-3 invisible right-10 text-black bg-slate-50 border border-gray-100 rounded-md">
        <button onClick={() => setHideReasoning(p => !p)} className="cursor-pointer group/btn p-2 hover:bg-gray-100 rounded h-full w-full transition-all text-gray-800">
          <Brain className="transition-transform group-hover/btn:scale-110" size={16}/>
        </button>
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
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <p className="font-bold font-gg-sans">anonymous</p>
        <div className="rounded whitespace-pre-wrap break-words text-[16px] leading-[1.55] text-slate-800">
          {message.content}
        </div>
      </div>
    </article>
  );
}
