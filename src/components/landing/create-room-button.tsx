"use client";

import { clsx } from "clsx";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

/**
 * Primary CTA. A real <form method="post"> (works without JS, survives slow
 * hydration) enhanced with an instant pending state so the click feels
 * immediate while the room is provisioned server-side.
 */
export function CreateRoomButton({ size = "lg", label = "Create Live Demo Room ⚡" }: { size?: "md" | "lg"; label?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <form action="/api/auth/demo" method="post" onSubmit={() => setPending(true)}>
      <button
        type="submit"
        disabled={pending}
        className={clsx(
          "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-accent font-medium text-white transition-all duration-200",
          "shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_10px_40px_-10px_rgba(139,92,246,0.9)]",
          "hover:bg-accent-strong hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset,0_14px_50px_-8px_rgba(139,92,246,1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-wait disabled:opacity-90",
          size === "lg" ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-[13px]",
        )}
      >
        {/* Sheen sweep on hover */}
        <span
          aria-hidden
          className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-700 group-hover:left-[120%] group-hover:opacity-100"
        />
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Spinning up your room…
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
