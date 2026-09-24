"use client";

import { clsx } from "clsx";
import { Tooltip } from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/ui/user-avatar";

export interface PresenceUserView {
  userId: string;
  name: string;
  avatarUrl: string | null;
  connections: number;
}

interface AvatarStackProps {
  users: readonly PresenceUserView[];
  selfId: string | undefined;
  connecting: boolean;
  max?: number;
}

/**
 * Overlapping avatars of everyone with a live WebSocket on this board. The
 * pulsing violet halo is literally the socket: it exists only while that
 * user's presence subscription is open.
 */
export function AvatarStack({ users, selfId, connecting, max = 4 }: AvatarStackProps) {
  if (connecting && users.length === 0) {
    return (
      <div className="flex -space-x-1.5" aria-label="Connecting to presence">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-6 rounded-full bg-[linear-gradient(90deg,#18181b_0%,#27272a_50%,#18181b_100%)] bg-[length:200%_100%] ring-2 ring-canvas animate-shimmer"
          />
        ))}
      </div>
    );
  }

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-0.5" aria-label={`${users.length} people viewing this board`}>
        {visible.map((user, i) => (
          <li key={user.userId} className="animate-fade-in" style={{ zIndex: visible.length - i }}>
            <Tooltip
              content={
                <span className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-neon" />
                  {user.name}
                  {user.userId === selfId && <span className="text-zinc-500">(you)</span>}
                  {user.connections > 1 && (
                    <span className="font-mono text-[10px] text-zinc-500">· {user.connections} tabs</span>
                  )}
                </span>
              }
            >
              <button
                type="button"
                className="relative block rounded-full ring-2 ring-canvas transition-all duration-200 hover:z-50 hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
              >
                <span className="block rounded-full animate-glow">
                  <UserAvatar userId={user.userId} name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                </span>
              </button>
            </Tooltip>
          </li>
        ))}
        {overflow > 0 && (
          <li>
            <Tooltip content={users.slice(max).map((u) => u.name).join(", ")}>
              <span
                tabIndex={0}
                className="relative inline-flex size-6 items-center justify-center rounded-full bg-overlay font-mono text-[10px] text-zinc-300 ring-2 ring-canvas"
              >
                +{overflow}
              </span>
            </Tooltip>
          </li>
        )}
      </ul>
      <span className={clsx("hidden font-mono text-[11px] text-zinc-500 lg:inline")}>{users.length} online</span>
    </div>
  );
}
