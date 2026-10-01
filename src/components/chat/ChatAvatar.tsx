import { Sparkles } from "lucide-react";

export function ChatAvatar({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      aria-label="Spekter AI"
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm ${size === "sm" ? "size-8" : "size-10"}`}
      role="img"
    >
      <Sparkles className={size === "sm" ? "size-4" : "size-[18px]"} strokeWidth={1.8} />
    </div>
  );
}
