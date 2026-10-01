import { ArrowUp, ChevronDown, Mic, Plus, Sparkles } from "lucide-react";

export function MainTextInput() {
  return (
    <div className="relative w-full max-w-3xl">
      <div className="rounded-[1.75rem] border border-white/80 bg-white/65 p-2 shadow-[0_22px_70px_-28px_rgba(51,65,92,0.24),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-slate-900/[0.04] backdrop-blur-2xl transition-shadow duration-300 focus-within:shadow-[0_24px_70px_-28px_rgba(51,65,92,0.3),inset_0_1px_0_rgba(255,255,255,0.95)]">
        <textarea
          aria-label="Message"
          className="min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 sm:px-5"
          placeholder="Message Spekter..."
          rows={2}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-2 sm:px-3">
          <div className="flex items-center gap-2">
            <button
              aria-label="Add attachment"
              className="flex size-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              type="button"
            >
              <Plus className="size-[18px]" strokeWidth={1.8} />
            </button>
            <button
              className="hidden h-9 items-center gap-2 rounded-full border border-white/80 bg-white/55 px-3 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:flex"
              type="button"
            >
              <Sparkles className="size-3.5 text-violet-500" strokeWidth={1.8} />
              Spekter
              <ChevronDown className="size-3.5 text-slate-400" strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Use voice input"
              className="flex size-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              type="button"
            >
              <Mic className="size-4" strokeWidth={1.8} />
            </button>
            <button
              aria-label="Send message"
              className="flex size-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_4px_12px_rgba(15,23,42,0.22)] transition-all hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-[0_7px_18px_rgba(109,40,217,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              type="button"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}