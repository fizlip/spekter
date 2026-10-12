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
import { Combobox } from "@base-ui/react/combobox";
import { COMMANDS } from "@/core/chat/commands.meta";
import { CommandPalette, type CommandItem } from "./CommandPalette";

const PALETTE_ITEMS: CommandItem[] = COMMANDS.map(({ name, description }) => ({ name, text: description }));

export function ChatComposer({
  value,
  onChange,
  onSend,
  model,
  models,
  onSelectModel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  model: string | null;
  models: { id: string; name: string }[];
  onSelectModel: (model: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [skill, setSkill] = useState("")
  const [activeIndex, setActiveIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);

  const paletteOpen = value.startsWith("/") && !/\s/.test(value.slice(1)) && !paletteDismissed;
  const query = value.slice(1).toLowerCase();
  const matches = PALETTE_ITEMS.filter(
    (command) =>
      command.name.toLowerCase().includes(query) || command.text.toLowerCase().includes(query),
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;

    setActiveIndex(0);
    if (!value.startsWith("/")) setPaletteDismissed(false);
  }, [value]);

  // Completes the command token in place (trailing space closes the palette) instead
  // of replacing the field, so text before or after the command is preserved.
  const selectCommand = (item: CommandItem) => {
    onChange(value.replace(/\/\S*$/, `/${item.name} `));
  };

  return (
    <form
      className="relative m-1 flex flex-col gap-1 rounded-[0.5rem] shadow bg-chat p-1 transition-shadow focus-within:border-slate-300"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      {paletteOpen && (
        <CommandPalette
          items={matches}
          activeIndex={activeIndex}
          onSelect={selectCommand}
          onHover={setActiveIndex}
        />
      )}
      <label className="sr-only" htmlFor="chat-message">
        Message
      </label>
      <textarea
        className="min-h-9 max-h-36 w-full min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-1.5 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
        id="chat-message"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (paletteOpen) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (matches.length ? (index + 1) % matches.length : 0));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) =>
                matches.length ? (index - 1 + matches.length) % matches.length : 0,
              );
              return;
            }
            if (event.key === "Escape") {
              setPaletteDismissed(true);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && matches[activeIndex]) {
              event.preventDefault();
              selectCommand(matches[activeIndex]);
              return;
            }
          }
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
          <Combobox.Root
            items={models}
            value={models.find((entry) => entry.id === model) ?? null}
            onValueChange={(value) => value && onSelectModel(value.id)}
            itemToStringLabel={(item) => item.id}
            isItemEqualToValue={(item, value) => item.id === value.id}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Combobox.Trigger
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-transparent p-1 text-sm text-slate-500 outline-none hover:bg-gray-100 hover:text-black"
                  />
                }
              >
                {model ?? "Model"}
              </TooltipTrigger>
              <TooltipContent side="bottom">Model</TooltipContent>
            </Tooltip>
            <Combobox.Portal>
              <Combobox.Positioner side="top" align="start" sideOffset={4} className="z-50">
                <Combobox.Popup className="w-72 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
                  <Combobox.Input
                    placeholder="Search models"
                    className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                  />
                  <Combobox.Empty className="px-2 py-1.5 text-sm text-slate-500">
                    No models found
                  </Combobox.Empty>
                  <Combobox.List className="max-h-56 overflow-y-auto">
                    {(item: { id: string; name: string }) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        className="cursor-pointer rounded-md px-2 py-1.5 text-sm data-[highlighted]:bg-gray-100"
                      >
                        {item.id}
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
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
