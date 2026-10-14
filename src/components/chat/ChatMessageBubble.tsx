import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { math } from "@streamdown/math";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import type { ChatMessage } from "./types";
import {useEffect, useRef, useState} from "react"
import {Brain, ChevronDown, FileText, ThumbsUp, ThumbsDown, Wrench} from "lucide-react"
import { mermaid } from "@streamdown/mermaid";

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

function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest}s` : `${minutes} min`;
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
      className={`text-[11px] tabular-nums text-slate-900 ${alignment === "left" ? "text-left" : "text-right"}`}
      dateTime={createdAt}
    >
      {formatTime(createdAt)}
    </time>
  );
}

export function ReasoningMessage({ message }: { message: ChatMessage }) {
  const reasoningRef = useRef<HTMLDivElement>(null)
  const streaming = message.status === "streaming"
  // Defaults to open while reasoning streams in, closed once the reply takes over;
  // clicking the header overrides either way.
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? streaming
  // Reasoning duration is measured from the message's createdAt (first frame) to the
  // moment streaming ends; the ref guards against a remount of a finished message.
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const wasStreaming = useRef(streaming)

  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      setDurationMs(Date.now() - Date.parse(message.createdAt))
    }
    wasStreaming.current = streaming
  }, [streaming, message.createdAt])

  useEffect(() => {
    const el = reasoningRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [message.content, isOpen])

  return (
    <article
      aria-label={`Spekter reasoning at ${formatTime(message.createdAt)}`}
      className="flex items-start gap-2 justify-start px-2"
    >
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          className="flex items-center gap-1.5 my-auto cursor-pointer self-start text-sm font-medium tracking-wide text-black hover:text-slate-600"
        >
          <Brain size={14}/>
          <span className={streaming ? "text-flare" : ""}>
            {streaming ? "Thinking" : durationMs === null ? "Thoughts" : `Thought for ${formatDuration(durationMs)}`}
          </span>
          <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`}/>
        </button>
        {isOpen && (
          <div
            ref={reasoningRef}
            className={streaming ? `
              max-h-[200px] overflow-auto py-2 my-2 leading-[1.25] pl-2
              [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
            ` : "leading-[1.25] pl-4 my-2 border-l border-black/20"}
            >
              <p className={streaming ? "whitespace-pre-wrap p-1 rounded-md text-black text-xs" : "whitespace-pre-wrap text-xs"}>
                {message.content}
              </p>
          </div>
        )}
      </div>
    </article>
  )
}

export function SourceMessage({ message }: { message: ChatMessage }) {
  return (
    <article
      aria-label={`Spekter sources at ${formatTime(message.createdAt)}`}
      className="flex items-start gap-2 justify-start px-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-1">
        {message.sources?.map((source) =>
          "path" in source ? (
            <p key={source.path} className="flex items-center gap-1.5 text-sm font-medium tracking-wide text-black">
              <FileText size={14} className="shrink-0" />
              Read {source.path}
            </p>
          ) : null,
        )}
      </div>
    </article>
  );
}

const TOOL_VERBS: Record<string, { doing: string; done: string }> = {
  read_file: { doing: "Reading", done: "Read" },
  list_files: { doing: "Listing", done: "Listed" },
  write_file: { doing: "Writing", done: "Wrote" },
  edit_file: { doing: "Editing", done: "Edited" },
  delete_file: { doing: "Deleting", done: "Deleted" },
};

export function ToolMessage({ message }: { message: ChatMessage }) {
  if (!message.tool) return null;
  const { name, state, path } = message.tool;
  const verbs = TOOL_VERBS[name];
  const subject = path ?? name;

  return (
    <article
      aria-label={`Spekter tool call at ${formatTime(message.createdAt)}`}
      className="flex items-start gap-2 justify-start px-2"
    >
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <p
          className={`flex items-center gap-1.5 text-sm font-medium tracking-wide ${state === "failed" ? "text-red-700" : "text-black"}`}
        >
          <Wrench size={14} className="shrink-0" />
          {state === "running" ? (
            <span className="text-flare">
              {verbs ? `${verbs.doing} ${subject}` : `Calling ${name}`}
            </span>
          ) : state === "succeeded" ? (
            verbs ? `${verbs.done} ${subject}` : `Used ${name}`
          ) : (
            `${name} failed`
          )}
        </p>
      </div>
    </article>
  );
}

export function AssistantMessage({ message, showAvatar = true }: { message: ChatMessage; showAvatar?: boolean }) {
  return (
    <article
      aria-label={`Spekter at ${formatTime(message.createdAt)}`}
      className="group relative flex items-start gap-2 justify-start px-2"
    >
      <div className="flex min-w-0 flex-1 flex-col p-1">
        <div className="rounded break-words text-[16px] leading-[1.5] text-black">
        {(message.content && <Streamdown plugins={{ math, code, mermaid }} className="leading-[1.4]">{message.content}</Streamdown>) ||
          (message.status === "streaming" && (
            <span aria-label="Spekter is replying" className="flex items-center animate-pulse text-xs">
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
        {showAvatar && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Avatar className="mt-1 after:hidden">
                  <AvatarImage src="/afry.png" alt="Spekter" />
                  <AvatarFallback>SP</AvatarFallback>
                </Avatar>
              }
            />
            <TooltipContent side="right">Hi! I'm Afryend. <br />How can I help you today?</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center group-hover:visible absolute -top-3 invisible right-10 text-black bg-slate-50 border border-gray-100 rounded-md">
        <button className="cursor-pointer group/btn p-2 hover:bg-gray-100 rounded h-full w-full transition-all text-gray-800">
          <ThumbsUp className="transition-transform group-hover/btn:scale-110" size={16} />
        </button>
        <button className="cursor-pointer group/btn p-2 hover:bg-gray-100 rounded h-full w-full transition-all text-gray-800">
          <ThumbsDown className="transition-transform group-hover/btn:scale-110" size={16} />
        </button>
      </div>
    </article>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article
      aria-label={`You at ${formatTime(message.createdAt)}`}
      className="flex items-end gap-2 justify-end px-2 my-4"
    >
      <div className="flex min-w-0 flex-1 flex-col items-end p-1">
        <div className="max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-gray-100 px-3 py-2 text-left text-[16px] leading-[1.55] text-slate-800">
          {message.content}
        </div>
      </div>
    </article>
  );
}
