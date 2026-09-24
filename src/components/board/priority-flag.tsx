import { clsx } from "clsx";
import { Flag } from "lucide-react";
import type { BoardTask } from "~/trpc/shared";

type Priority = BoardTask["priority"];

export const PRIORITY_META: Record<Priority, { label: string; short: string; className: string; rank: number }> = {
  urgent: { label: "Urgent", short: "URG", rank: 4, className: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  high: { label: "High", short: "HIGH", rank: 3, className: "text-orange-300 bg-orange-500/10 border-orange-500/20" },
  medium: { label: "Medium", short: "MED", rank: 2, className: "text-yellow-200/90 bg-yellow-500/10 border-yellow-500/15" },
  low: { label: "Low", short: "LOW", rank: 1, className: "text-zinc-400 bg-white/[0.03] border-hairline" },
  none: { label: "No priority", short: "—", rank: 0, className: "text-zinc-600 bg-transparent border-hairline" },
};

export const PRIORITY_CYCLE: readonly Priority[] = ["none", "low", "medium", "high", "urgent"];

export function PriorityFlag({ priority, showNone = false }: { priority: Priority; showNone?: boolean }) {
  if (priority === "none" && !showNone) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      title={`Priority: ${meta.label}`}
      className={clsx(
        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 font-mono text-[10px] font-medium tracking-wide",
        meta.className,
      )}
    >
      <Flag className="size-3" strokeWidth={2.25} fill={priority === "none" ? "none" : "currentColor"} fillOpacity={0.25} />
      {meta.short}
    </span>
  );
}
