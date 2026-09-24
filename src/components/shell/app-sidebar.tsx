"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Check, ChevronsUpDown, Hash, LogOut, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import { LegalLink } from "~/components/legal/legal-dialog";
import { Kbd } from "~/components/ui/kbd";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import type { RealtimeStatus } from "./connection-status";

interface AppSidebarProps {
  workspaceId: string;
  currentBoardId: string;
  me: RouterOutputs["user"]["me"] | undefined;
  query: string;
  onQueryChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Cards on the current board matching the query (null when no query). */
  matchCount: number | null;
  realtimeStatus: RealtimeStatus;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({
  workspaceId,
  currentBoardId,
  me,
  query,
  onQueryChange,
  searchRef,
  matchCount,
  realtimeStatus,
  mobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const trpc = useTRPC();
  const sidebar = useQuery(trpc.workspace.sidebar.queryOptions({ workspaceId }));
  const workspaces = useQuery(trpc.workspace.list.queryOptions());
  const isMac = useIsMac();

  const q = query.trim().toLowerCase();
  const allBoards = sidebar.data?.boards ?? [];
  const matchingBoards = q ? allBoards.filter((b) => b.name.toLowerCase().includes(q)) : allBoards;
  // The search also filters cards; if no board NAME matches, keep navigation visible.
  const boardsFiltered = matchingBoards.length > 0;
  const boards = boardsFiltered ? matchingBoards : allBoards;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onMobileClose}
        className={clsx(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        aria-label="Workspace navigation"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 ease-out",
          "md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* ── Workspace switcher ─────────────────────────────── */}
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-hairline px-3">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-all duration-200 hover:bg-white/[0.04] data-[state=open]:bg-white/[0.04]"
              >
                <LogoMark />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white">
                    {sidebar.data?.workspace.name ?? "Loading…"}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                    {sidebar.data ? `${sidebar.data.workspace.key} · ${sidebar.data.role}` : "workspace"}
                  </span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-zinc-600 transition-colors duration-200 group-hover:text-zinc-300" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-50 w-60 animate-fade-in rounded-lg border border-hairline-strong bg-overlay p-1 shadow-2xl shadow-black/60"
              >
                <DropdownMenu.Label className="px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Workspaces
                </DropdownMenu.Label>
                {workspaces.data?.map((ws) => {
                  const active = ws.id === workspaceId;
                  const inner = (
                    <>
                      <span className="inline-flex size-5 items-center justify-center rounded bg-white/[0.06] font-mono text-[9px] text-zinc-300">
                        {ws.key.slice(0, 2)}
                      </span>
                      <span className="flex-1 truncate">{ws.name}</span>
                      {active && <Check className="size-3.5 text-accent" />}
                    </>
                  );
                  const itemClass =
                    "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-zinc-300 outline-none transition-colors duration-150 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white data-[disabled]:opacity-40";
                  return ws.firstBoardId && !active ? (
                    <DropdownMenu.Item key={ws.id} asChild className={itemClass}>
                      <Link href={`/boards/${ws.firstBoardId}`}>{inner}</Link>
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item key={ws.id} disabled={!active} className={itemClass}>
                      {inner}
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close sidebar"
            className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200 md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ── Command search ─────────────────────────────────── */}
        <div className="px-3 pt-3">
          <label className="group relative flex h-9 items-center gap-2 rounded-lg border border-hairline bg-canvas/60 px-2.5 transition-all duration-200 focus-within:border-accent/50 focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.14)] hover:border-hairline-strong">
            <Search className="size-3.5 shrink-0 text-zinc-600 transition-colors duration-200 group-focus-within:text-accent" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onQueryChange("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search…"
              aria-label="Search tasks and boards"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                aria-label="Clear search"
                className="text-zinc-600 transition-colors duration-200 hover:text-zinc-300"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <span className="flex items-center gap-0.5">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </span>
            )}
          </label>
          {matchCount !== null && (
            <p className="mt-2 px-1 font-mono text-[10.5px] text-zinc-500">
              <span className={matchCount > 0 ? "text-accent" : "text-rose-400"}>{matchCount}</span> matching{" "}
              {matchCount === 1 ? "task" : "tasks"} on this board
            </p>
          )}
        </div>

        {/* ── Boards ─────────────────────────────────────────── */}
        <nav className="scrollbar-thin mt-4 flex-1 overflow-y-auto px-3" aria-label="Boards">
          <p className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">Boards</p>
          {sidebar.isPending ? (
            <ul className="space-y-1">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-8 rounded-md bg-[linear-gradient(90deg,#141416_0%,#1c1c1f_50%,#141416_100%)] bg-[length:200%_100%] animate-shimmer"
                />
              ))}
            </ul>
          ) : (
            <ul className="space-y-0.5">
              {q && !boardsFiltered && (
                <li className="px-2 pb-1 text-[11px] text-zinc-600">No board names match — filtering cards.</li>
              )}
              {boards.map((board) => {
                const active = board.id === currentBoardId;
                return (
                  <li key={board.id}>
                    <Link
                      href={`/boards/${board.id}`}
                      onClick={onMobileClose}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "group relative flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-all duration-200",
                        active
                          ? "bg-white/[0.05] text-white"
                          : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100",
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_rgba(139,92,246,0.9)]"
                        />
                      )}
                      <Hash
                        className={clsx(
                          "size-3.5 shrink-0 transition-colors duration-200",
                          active ? "text-accent" : "text-zinc-600 group-hover:text-zinc-400",
                        )}
                      />
                      <span className="flex-1 truncate">{board.name}</span>
                      <span className="font-mono text-[10.5px] tabular-nums text-zinc-600">{board.taskCount}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* ── Realtime diagnostics + user ────────────────────── */}
        <div className="shrink-0 space-y-2 border-t border-hairline p-3">
          <div className="flex items-center justify-between rounded-lg border border-hairline bg-white/[0.015] px-2.5 py-2 font-mono text-[10.5px]">
            <span className="text-zinc-600">realtime</span>
            <span
              className={clsx(
                "flex items-center gap-1.5",
                realtimeStatus === "pending" && "text-neon",
                realtimeStatus === "connecting" && "text-zinc-400",
                realtimeStatus === "idle" && "text-zinc-500",
                realtimeStatus === "error" && "text-rose-400",
              )}
            >
              <span
                className={clsx(
                  "size-1.5 rounded-full",
                  realtimeStatus === "pending" && "bg-neon shadow-[0_0_6px_rgba(45,212,191,0.9)]",
                  realtimeStatus === "connecting" && "animate-pulse bg-zinc-400",
                  realtimeStatus === "idle" && "bg-zinc-600",
                  realtimeStatus === "error" && "bg-rose-400",
                )}
              />
              {realtimeStatus === "pending" ? "ws · connected" : realtimeStatus === "error" ? "ws · retrying" : "ws · connecting"}
            </span>
          </div>

          {me && (
            <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
              <UserAvatar userId={me.id} name={me.name} avatarUrl={me.avatarUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-zinc-100">{me.name}</p>
                <p className="truncate font-mono text-[10.5px] text-zinc-600">{me.email}</p>
              </div>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="inline-flex size-7 items-center justify-center rounded-md text-zinc-600 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  <LogOut className="size-3.5" />
                </button>
              </form>
            </div>
          )}

          <nav aria-label="Legal" className="flex items-center gap-3 px-1.5 pt-0.5 text-[11px] text-zinc-600">
            <LegalLink doc="privacy">Privacy</LegalLink>
            <span aria-hidden className="text-zinc-800">·</span>
            <LegalLink doc="terms">Terms</LegalLink>
          </nav>
        </div>
      </aside>
    </>
  );
}

/** Syncra glyph: a 2×2 matrix with one lit cell — a board in miniature. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-[#1f1a2e] to-[#0d0b14] shadow-[0_0_18px_-4px_rgba(139,92,246,0.7)]",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#8b5cf6" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.2" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.2" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.45" />
      </svg>
    </span>
  );
}

/** Keyboard hint label; resolved after mount to avoid a hydration mismatch. */
function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);
  return isMac;
}
