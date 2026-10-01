import { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [value]);

  return (
    <form
      className="flex items-end gap-2 rounded-[1.6rem] border border-slate-200/90 bg-white p-2 shadow-[0_8px_28px_-18px_rgba(15,23,42,0.28)] transition-shadow focus-within:border-slate-300 focus-within:shadow-[0_10px_36px_-16px_rgba(15,23,42,0.22)]"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <label className="sr-only" htmlFor="chat-message">
        Message
      </label>
      <textarea
        className="min-h-9 max-h-36 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
        id="chat-message"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="Send a follow-up"
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <button
        aria-label="Send message"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        disabled={disabled || !value.trim()}
        type="submit"
      >
        <ArrowUp className="size-[18px]" strokeWidth={2.2} />
      </button>
    </form>
  );
}
