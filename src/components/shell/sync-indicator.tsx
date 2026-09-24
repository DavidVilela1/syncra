"use client";

import { useIsMutating } from "@tanstack/react-query";
import { CheckCheck, Loader2 } from "lucide-react";

/** Shows whether optimistic changes are still in flight to the server. */
export function SyncIndicator() {
  const inFlight = useIsMutating();
  return (
    <span
      className="hidden h-7 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-zinc-500 sm:inline-flex"
      aria-live="polite"
    >
      {inFlight > 0 ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-accent" />
          <span className="text-accent">Syncing{inFlight > 1 ? ` ×${inFlight}` : ""}</span>
        </>
      ) : (
        <>
          <CheckCheck className="size-3.5 text-zinc-600" />
          Saved
        </>
      )}
    </span>
  );
}
