import { useEffect, useRef } from "react";

export function ChatComposer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
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
      className="flex items-end gap-2 rounded-[0.5rem] border border-slate-200/90 bg-white p-1 transition-shadow focus-within:border-slate-300"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <label className="sr-only" htmlFor="chat-message">
        Message
      </label>
      <textarea
        className="min-h-9 max-h-36 w-full min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
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
    </form>
  );
}
