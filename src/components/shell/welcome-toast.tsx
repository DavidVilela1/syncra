"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

export interface WelcomeIdentity {
  name: string;
  title: string;
  avatarUrl: string;
}

/**
 * "You joined as Bruno Costa" — shown once after entering a room. It also
 * strips the one-off `?as=` flag from the address bar so a refresh doesn't
 * repeat it and a manually copied URL stays a clean invite link.
 */
export function WelcomeToast({ identity }: { identity: WelcomeIdentity }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("as")) {
      url.searchParams.delete("as");
      window.history.replaceState(window.history.state, "", url);
    }
    const id = window.setTimeout(() => setOpen(false), 6000);
    return () => window.clearTimeout(id);
  }, []);

  if (!open) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 animate-slide-up items-center gap-3 rounded-xl border border-accent/25 bg-overlay/95 p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9),0_0_30px_-12px_rgba(139,92,246,0.6)] backdrop-blur-xl"
    >
      {/* Same-origin SVG from /public — no remote host to allow-list for next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={identity.avatarUrl} alt="" className="size-9 rounded-full ring-2 ring-accent/40" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-white">
          <Sparkles className="size-3.5 text-accent" />
          You joined as {identity.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {identity.title} · Drag a card — everyone in the room sees it instantly.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
