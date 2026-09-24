"use client";

import { Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { ROOM_CAPACITY } from "~/lib/personas";

/** "23h" / "41m" — coarse on purpose; rooms slide forward on every join anyway. */
function timeLeft(expiresAt: number, now: number): string {
  const ms = Math.max(0, expiresAt - now);
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/** Room id, live seat count and time-to-expiry, in one compact mono chip. */
export function RoomBadge({ roomId, expiresAt, online }: { roomId: string; expiresAt: string; online: number }) {
  const expiry = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Tooltip
      content={
        <span className="block max-w-56 leading-5">
          Live demo room. Everyone here shares one workspace — moves sync over WebSockets. Expires{" "}
          {timeLeft(expiry, now)} after the last join.
        </span>
      }
    >
      <span
        tabIndex={0}
        className="hidden h-7 items-center gap-2 rounded-full border border-hairline bg-white/[0.02] px-2.5 font-mono text-[10.5px] text-zinc-400 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:inline-flex"
      >
        <Radio className="size-3 text-accent" />
        <span className="text-zinc-300">{roomId}</span>
        <span className="text-zinc-700">·</span>
        <span>
          {Math.min(online, ROOM_CAPACITY)}/{ROOM_CAPACITY} seats
        </span>
        <span className="text-zinc-700">·</span>
        <span>{timeLeft(expiry, now)} left</span>
      </span>
    </Tooltip>
  );
}
