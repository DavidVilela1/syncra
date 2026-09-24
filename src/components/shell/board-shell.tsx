"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock, SearchX } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoardSkeleton } from "~/components/board/board-skeleton";
import { KanbanGrid } from "~/components/board/kanban-grid";
import { taskMatchesQuery } from "~/components/board/board-column";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useBoardRealtime } from "~/hooks/use-board-realtime";
import { useCreateTask } from "~/hooks/use-create-task";
import { useMoveTask } from "~/hooks/use-move-task";
import { usePresence } from "~/hooks/use-presence";
import { useTRPC } from "~/trpc/react";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { ErrorToast } from "./error-toast";
import { WelcomeToast, type WelcomeIdentity } from "./welcome-toast";

export interface RoomContext {
  id: string;
  /** ISO timestamp — plain data so it can cross the server→client boundary. */
  expiresAt: string;
  /** Set only on the first render after joining (drives the welcome toast). */
  welcome: WelcomeIdentity | null;
}

/**
 * Composition root of the board page. Owns cross-cutting UI state (search,
 * mobile sidebar) and the data hooks, and hands plain props/callbacks down —
 * leaf components stay presentational and memo-friendly.
 */
export function BoardShell({ boardId, room }: { boardId: string; room: RoomContext | null }) {
  const trpc = useTRPC();
  const boardQuery = useQuery(trpc.board.byId.queryOptions({ boardId }));
  const meQuery = useQuery(trpc.user.me.queryOptions());

  const { moveTask, error: moveError, reset: resetMove } = useMoveTask(boardId);
  const { createTask, error: createError, reset: resetCreate } = useCreateTask(boardId);
  const { status: realtimeStatus } = useBoardRealtime(boardId);
  const presence = usePresence(boardId);

  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep typing snappy on large boards: filtering renders at lower priority.
  const normalizedQuery = useDeferredValue(query.trim().toLowerCase());

  // ⌘K / Ctrl+K focuses the command search from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const board = boardQuery.data;
  const stats = useMemo(() => {
    if (!board) return { total: 0, matches: null as number | null };
    let total = 0;
    let matches = 0;
    for (const column of board.columns) {
      for (const task of column.tasks) {
        total++;
        if (taskMatchesQuery(task, board.workspace.key, normalizedQuery)) matches++;
      }
    }
    return { total, matches: normalizedQuery ? matches : null };
  }, [board, normalizedQuery]);

  if (boardQuery.isPending) return <BoardSkeleton />;

  if (boardQuery.isError) {
    const code = boardQuery.error.data?.code;
    return (
      <FullPageMessage
        icon={code === "UNAUTHORIZED" ? <Lock className="size-5 text-accent" /> : <SearchX className="size-5 text-accent" />}
        title={code === "UNAUTHORIZED" ? "Your session has expired" : "Board not found"}
        body={
          code === "UNAUTHORIZED"
            ? "Sign in again with one of the dev login links printed by `npm run db:seed`."
            : "It may have been deleted, or it belongs to a workspace you’re not a member of."
        }
      />
    );
  }

  const loadedBoard = boardQuery.data;
  const activeError = moveError ?? createError;
  const toast = activeError
    ? {
        // 429s get their own wording: the change was rolled back, and nothing is broken.
        title:
          activeError.data?.code === "TOO_MANY_REQUESTS"
            ? "Slow down"
            : moveError
              ? "Move reverted"
              : "Couldn’t create task",
        message: activeError.message,
        onDismiss: moveError ? resetMove : resetCreate,
      }
    : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-dvh overflow-hidden bg-canvas text-zinc-400">
        <AppSidebar
          workspaceId={loadedBoard.workspace.id}
          currentBoardId={loadedBoard.id}
          me={meQuery.data}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          matchCount={stats.matches}
          realtimeStatus={realtimeStatus}
          mobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
        />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Ambient top glow + dot grid: depth without decoration. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-dot-grid [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60%] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl"
          />

          <AppHeader
            workspaceName={loadedBoard.workspace.name}
            workspaceKey={loadedBoard.workspace.key}
            boardName={loadedBoard.name}
            taskCount={stats.total}
            presence={presence.users}
            presenceConnecting={presence.status === "connecting"}
            selfId={meQuery.data?.id}
            realtimeStatus={realtimeStatus}
            onOpenSidebar={() => setSidebarOpen(true)}
            room={room ? { id: room.id, expiresAt: room.expiresAt } : null}
          />

          <main className="relative min-h-0 flex-1">
            <KanbanGrid board={loadedBoard} query={normalizedQuery} moveTask={moveTask} createTask={createTask} />
          </main>
        </div>

        {toast && <ErrorToast key={toast.title} {...toast} />}
        {room?.welcome && <WelcomeToast identity={room.welcome} />}
      </div>
    </TooltipProvider>
  );
}

function FullPageMessage({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-canvas bg-dot-grid p-6">
      <div className="w-full max-w-sm animate-slide-up rounded-2xl border border-hairline bg-surface p-6 text-center shadow-2xl shadow-black/50">
        <span className="mx-auto mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft">
          {icon}
        </span>
        <h1 className="text-base font-semibold text-white">{title}</h1>
        <p className="mt-2 text-[13px] leading-5 text-zinc-500">{body}</p>
        <Link
          href="/"
          className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline-strong bg-white/[0.03] px-3 text-[13px] text-zinc-200 transition-all duration-200 hover:border-accent/40 hover:bg-accent-soft"
        >
          <ArrowLeft className="size-3.5" />
          Back home
        </Link>
      </div>
    </div>
  );
}
