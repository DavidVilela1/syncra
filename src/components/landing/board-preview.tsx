import { clsx } from "clsx";
import { Flag } from "lucide-react";
import { PERSONAS } from "~/lib/personas";

interface PreviewCard {
  id: string;
  title: string;
  priority?: "HIGH" | "MED" | "URG";
}

const COLUMNS: ReadonlyArray<{ name: string; dot: string; cards: readonly PreviewCard[] }> = [
  {
    name: "Todo",
    dot: "border-zinc-400",
    cards: [
      { id: "SYN-105", title: "Card detail drawer", priority: "HIGH" },
      { id: "SYN-106", title: "Invite via magic link", priority: "MED" },
    ],
  },
  {
    name: "In Progress",
    dot: "border-amber-300 bg-amber-300/30",
    cards: [
      { id: "SYN-108", title: "Presence over WebSocket", priority: "URG" },
      { id: "SYN-109", title: "Optimistic rollback", priority: "HIGH" },
    ],
  },
  {
    name: "Done",
    dot: "border-accent bg-accent/40",
    cards: [
      { id: "SYN-111", title: "Fractional indexing" },
      { id: "SYN-112", title: "Drizzle migrations" },
      { id: "SYN-113", title: "Session cookies" },
    ],
  },
];

const PRIORITY_CLASS: Record<NonNullable<PreviewCard["priority"]>, string> = {
  URG: "text-rose-400 border-rose-500/25 bg-rose-500/10",
  HIGH: "text-orange-300 border-orange-500/25 bg-orange-500/10",
  MED: "text-yellow-200/90 border-yellow-500/20 bg-yellow-500/10",
};

function Card({ card, className }: { card: PreviewCard; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-hairline bg-elevated p-2.5", className)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-zinc-500">{card.id}</span>
        {card.priority && (
          <span
            className={clsx(
              "inline-flex items-center gap-0.5 rounded border px-1 font-mono text-[9px]",
              PRIORITY_CLASS[card.priority],
            )}
          >
            <Flag className="size-2.5" fill="currentColor" fillOpacity={0.25} />
            {card.priority}
          </span>
        )}
      </div>
      {/* Single line → every card has the same height, so rows align across columns. */}
      <p className="mt-1 truncate text-[11.5px] font-medium leading-4 text-zinc-200">{card.title}</p>
    </div>
  );
}

/**
 * Decorative, pure-CSS rendering of a live room: a remote teammate's cursor
 * carries a card from Todo to In Progress on a loop. No JS, no layout shift,
 * and `prefers-reduced-motion` stops the animation (see globals.css).
 */
export function BoardPreview() {
  const cast = PERSONAS.slice(0, 3);
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-[640px] rounded-2xl border border-white/10 bg-surface/80 p-2 shadow-[0_40px_120px_-30px_rgba(139,92,246,0.45),0_0_0_1px_rgba(255,255,255,0.03)_inset]"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-3 px-2 pb-2 pt-1">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
        </div>
        <div className="flex-1 truncate rounded-md border border-hairline bg-canvas/70 px-2 py-1 font-mono text-[10px] text-zinc-500">
          syncra.app/dashboard?room=<span className="text-zinc-300">k7q2m9xv4t</span>
        </div>
        <div className="flex -space-x-1">
          {cast.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.handle}
              src={p.avatarUrl}
              alt=""
              className="size-5 rounded-full ring-2 ring-surface animate-glow"
            />
          ))}
        </div>
        <span className="hidden items-center gap-1 rounded-full border border-neon/20 bg-neon/[0.06] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neon sm:inline-flex">
          <span className="size-1.5 rounded-full bg-neon shadow-[0_0_6px_rgba(45,212,191,0.9)]" />
          Live
        </span>
      </div>

      {/* Board. --hop = one column step: the card's own width + column padding (2×0.5rem) + border (2px) + gap (0.75rem). */}
      <div className="relative rounded-xl border border-hairline bg-canvas/60 p-3 [--hop:calc(100%+1.75rem+2px)]">
        <div className="grid grid-cols-3 gap-3">
          {COLUMNS.map((col, columnIndex) => (
            <div key={col.name} className="min-w-0 rounded-lg border border-hairline bg-surface/60 p-2">
              <div className="mb-2 flex items-center gap-1.5 px-0.5">
                <span className={clsx("size-2.5 rounded-full border", col.dot)} />
                <span className="truncate text-[11px] font-medium text-zinc-200">{col.name}</span>
                <span className="ml-auto font-mono text-[9px] text-zinc-600">{col.cards.length}</span>
              </div>
              <div className="space-y-2">
                {col.cards.map((card) => (
                  <Card key={card.id} card={card} />
                ))}
                {columnIndex === 0 && (
                  // The travelling card + Bruno's cursor. In normal flow (third row of Todo),
                  // translated sideways by exactly one column into In Progress's empty slot.
                  <div className="relative z-10 animate-card-hop">
                    <Card
                      card={{ id: "SYN-110", title: "Redis fan-out", priority: "HIGH" }}
                      className="border-accent/50 bg-[#16161a] shadow-[0_18px_40px_-14px_rgba(0,0,0,0.9),0_0_22px_-6px_rgba(139,92,246,0.6)]"
                    />
                    <div className="absolute -bottom-4 right-2 flex items-center gap-1">
                      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-12 text-amber-400" fill="currentColor">
                        <path d="M2 1l11 6-5 1.5L6 14z" />
                      </svg>
                      <span className="rounded bg-amber-400 px-1 font-mono text-[9px] font-semibold text-black">
                        Bruno
                      </span>
                    </div>
                  </div>
                )}
                {columnIndex === 1 && (
                  // Landing slot — same height as a card, so the drop lines up exactly.
                  <div className="rounded-lg border border-dashed border-accent/20 bg-accent/[0.03] p-2.5">
                    <div className="h-[15px]" />
                    <div className="mt-1 h-4" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
