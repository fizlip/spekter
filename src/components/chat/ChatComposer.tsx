import { useEffect, useRef, useState } from "react";

import { ArrowUp, Layers, Paperclip, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ChatComposer({
  value,
  onChange,
  onSend,
  model,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  model: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [skill, setSkill] = useState("")

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [value]);

  return (
    <form
      className="m-1 flex flex-col gap-1 rounded-[0.5rem] shadow bg-chat p-1 transition-shadow focus-within:border-slate-300"
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
        placeholder="Ask afryend"
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <div className="flex items-center justify-between px-2 pb-1">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-transparent p-1 text-sm text-slate-500 outline-none hover:bg-gray-100 hover:text-black"
                  />
                }
              >
                {!skill ? (
                  <p className="flex gap-2 items-center">
                    <Plus size={16} />
                  </p>
                ) : (
                  <p>{skill}</p>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">Add context</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start">
              <DropdownMenuItem onClick={() => setSkill("Skill")}>Create skill</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-transparent p-1 text-sm text-slate-500 hover:bg-gray-100 hover:text-black">
                  {model ?? "Model"}
                </div>
              }
            />
            <TooltipContent side="bottom">Model</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black"
          >
            <Paperclip size={16} />
          </button>
          <button
            type="submit"
            className="cursor-pointer rounded-full bg-emerald-600 p-1.5 text-white hover:bg-emerald-500"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
