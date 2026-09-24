import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-hairline-strong bg-white/[0.04] px-1 font-mono text-[10px] font-medium text-zinc-500",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
