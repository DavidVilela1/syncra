"use client";

import { ChevronRight, PanelLeft } from "lucide-react";
import Link from "next/link";
import { AvatarStack, type PresenceUserView } from "./avatar-stack";
import { ConnectionStatus, type RealtimeStatus } from "./connection-status";
import { RoomBadge } from "./room-badge";
import { ShareSessionButton } from "./share-session-button";
import { SyncIndicator } from "./sync-indicator";

interface AppHeaderProps {
  workspaceName: string;
  workspaceKey: string;
  boardName: string;
  taskCount: number;
  presence: readonly PresenceUserView[];
  presenceConnecting: boolean;
  selfId: string | undefined;
  realtimeStatus: RealtimeStatus;
  onOpenSidebar: () => void;
  /** Present when viewing a shareable demo room. */
  room: { id: string; expiresAt: string } | null;
}

export function AppHeader({
  workspaceName,
  workspaceKey,
  boardName,
  taskCount,
  presence,
  presenceConnecting,
  selfId,
  realtimeStatus,
  onOpenSidebar,
  room,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-canvas/80 px-4 backdrop-blur-xl md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="-ml-1 inline-flex size-8 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200 md:hidden"
        >
          <PanelLeft className="size-4" />
        </button>

        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <li className="hidden sm:block">
              <Link href="/" className="text-zinc-500 transition-colors duration-200 hover:text-zinc-200">
                Workspaces
              </Link>
            </li>
            <li aria-hidden className="hidden text-zinc-700 sm:block">
              <ChevronRight className="size-3.5" />
            </li>
            <li className="hidden items-center gap-1.5 text-zinc-400 sm:flex">
              <span className="font-mono text-[10.5px] text-zinc-600">{workspaceKey}</span>
              {workspaceName}
            </li>
            <li aria-hidden className="hidden text-zinc-700 sm:block">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-white">{boardName}</span>
              <span className="hidden rounded-md border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-500 md:inline">
                {taskCount} tasks
              </span>
            </li>
          </ol>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3 md:gap-4">
        {room && <RoomBadge roomId={room.id} expiresAt={room.expiresAt} online={presence.length} />}
        <SyncIndicator />
        <span aria-hidden className="hidden h-5 w-px bg-hairline-strong sm:block" />
        <AvatarStack users={presence} selfId={selfId} connecting={presenceConnecting} />
        <ConnectionStatus status={realtimeStatus} />
        {room && <ShareSessionButton roomId={room.id} />}
      </div>
    </header>
  );
}
