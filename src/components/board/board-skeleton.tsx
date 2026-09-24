const shimmer =
  "bg-[linear-gradient(90deg,#121214_0%,#1a1a1d_50%,#121214_100%)] bg-[length:200%_100%] animate-shimmer";

const COLUMN_CARD_COUNTS = [4, 3, 2, 1, 3] as const;

/** Layout-accurate placeholder: same widths/heights as the real board → zero layout shift. */
export function BoardSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas" aria-busy="true" aria-label="Loading board">
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-hairline bg-surface p-3 md:flex">
        <div className={`h-10 rounded-lg ${shimmer}`} />
        <div className={`h-9 rounded-lg ${shimmer}`} />
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h-8 rounded-md ${shimmer}`} />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-hairline px-6">
          <div className={`h-4 w-64 rounded ${shimmer}`} />
          <div className={`h-7 w-40 rounded-full ${shimmer}`} />
        </div>
        <div className="flex gap-3 overflow-hidden p-6">
          {COLUMN_CARD_COUNTS.map((cards, i) => (
            <div key={i} className="w-[296px] shrink-0 rounded-xl border border-hairline bg-surface/60 p-3">
              <div className={`mb-4 h-4 w-28 rounded ${shimmer}`} />
              <div className="space-y-2">
                {Array.from({ length: cards }, (_, j) => (
                  <div key={j} className={`h-[92px] rounded-xl border border-hairline ${shimmer}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
