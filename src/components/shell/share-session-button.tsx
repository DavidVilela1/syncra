"use client";

import { clsx } from "clsx";
import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies the room's invite URL. Anyone who opens it is seated as the next
 * free persona in the SAME workspace — no account, no setup.
 *
 * The URL is rebuilt from the room id rather than read verbatim from the
 * address bar, so one-off params (like the `?as=` welcome flag) never leak
 * into invites.
 */
export function ShareSessionButton({ roomId }: { roomId: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function copy() {
    const url = `${window.location.origin}/dashboard?room=${roomId}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = legacyCopy(url);
    }
    setState(ok ? "copied" : "failed");
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 2400);
  }

  const copied = state === "copied";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy invite link to this live room"
        className={clsx(
          "group inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-all duration-200",
          copied
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_-6px_rgba(52,211,153,0.8)]"
            : "border-accent/30 bg-accent-soft text-violet-200 hover:border-accent/60 hover:bg-accent/20 hover:text-white hover:shadow-[0_0_20px_-6px_rgba(139,92,246,0.9)]",
        )}
      >
        <span className="relative inline-flex size-3.5 items-center justify-center">
          <Link2
            className={clsx(
              "absolute size-3.5 transition-all duration-200",
              copied ? "scale-50 rotate-45 opacity-0" : "scale-100 opacity-100",
            )}
          />
          <Check
            className={clsx(
              "absolute size-3.5 transition-all duration-200",
              copied ? "scale-100 opacity-100" : "scale-50 -rotate-45 opacity-0",
            )}
            strokeWidth={2.5}
          />
        </span>
        <span className="hidden sm:inline">{copied ? "Copied!" : "Share session"}</span>
      </button>

      {/* Floating confirmation badge — announced to screen readers too. */}
      <div
        role="status"
        aria-live="polite"
        className={clsx(
          "pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border px-3 py-2 text-xs shadow-2xl shadow-black/60 transition-all duration-200",
          state === "idle" ? "invisible -translate-y-1 opacity-0" : "visible translate-y-0 opacity-100",
          state === "failed"
            ? "border-rose-500/25 bg-overlay text-rose-300"
            : "border-emerald-400/20 bg-overlay text-zinc-300",
        )}
      >
        {state === "failed" ? (
          <p>Couldn’t access the clipboard — copy the address bar instead.</p>
        ) : (
          <>
            <p className="flex items-center gap-1.5 font-medium text-emerald-300">
              <Check className="size-3.5" strokeWidth={2.5} />
              Invite link copied!
            </p>
            <p className="mt-0.5 text-zinc-500">Whoever opens it joins this room as the next teammate.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Clipboard fallback for insecure contexts (plain-HTTP LAN IPs) where navigator.clipboard is undefined. */
function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}
