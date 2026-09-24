import { clsx } from "clsx";

export type RealtimeStatus = "idle" | "connecting" | "pending" | "error";

const LABEL: Record<RealtimeStatus, string> = {
  pending: "Live",
  connecting: "Connecting",
  idle: "Idle",
  error: "Offline",
};

/** Pill showing the WebSocket state. tRPC's "pending" = subscribed & receiving. */
export function ConnectionStatus({ status }: { status: RealtimeStatus }) {
  const live = status === "pending";
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "inline-flex h-7 items-center gap-2 rounded-full border px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-all duration-200",
        live && "border-neon/20 bg-neon/[0.06] text-neon",
        status === "connecting" && "border-hairline bg-white/[0.02] text-zinc-400",
        status === "idle" && "border-hairline bg-white/[0.02] text-zinc-500",
        status === "error" && "border-rose-500/25 bg-rose-500/[0.06] text-rose-400",
      )}
    >
      <span className="relative flex size-2">
        {(live || status === "connecting") && (
          <span
            className={clsx(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              live ? "bg-neon" : "bg-zinc-400",
            )}
          />
        )}
        <span
          className={clsx(
            "relative inline-flex size-2 rounded-full",
            live && "bg-neon shadow-[0_0_8px_rgba(45,212,191,0.9)]",
            status === "connecting" && "bg-zinc-400",
            status === "idle" && "bg-zinc-600",
            status === "error" && "bg-rose-400",
          )}
        />
      </span>
      {LABEL[status]}
    </div>
  );
}
