"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";

interface ErrorToastProps {
  title: string;
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms. */
  timeoutMs?: number;
}

/** Surfaces a rolled-back optimistic change. The cache has already been restored. */
export function ErrorToast({ title, message, onDismiss, timeoutMs = 6000 }: ErrorToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, timeoutMs, message]);

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] animate-slide-up items-start gap-3 rounded-xl border border-rose-500/20 bg-overlay/95 p-3.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
    >
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-rose-500/10">
        <AlertTriangle className="size-3.5 text-rose-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-zinc-100">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
