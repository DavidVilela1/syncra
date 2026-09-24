"use client";

import { Droppable } from "@hello-pangea/dnd";
import { clsx } from "clsx";
import { Inbox, Plus, UnfoldHorizontal } from "lucide-react";
import { memo, useState } from "react";
import { formatTaskKey } from "~/lib/format";
import type { BoardColumn as BoardColumnData, BoardTask } from "~/trpc/shared";
import { ColumnMenu } from "./column-menu";
import { ColumnStatusIcon } from "./column-status-icon";
import { TaskCard } from "./task-card";
import { TaskComposer } from "./task-composer";

interface BoardColumnProps {
  column: BoardColumnData;
  workspaceKey: string;
  /** Normalized search query ("" = no filter). */
  query: string;
  collapsed: boolean;
  onToggleCollapsed: (columnId: string) => void;
  onCreateTask: (input: { columnId: string; title: string; priority: BoardTask["priority"] }) => void;
}

export function taskMatchesQuery(task: BoardTask, workspaceKey: string, query: string): boolean {
  if (!query) return true;
  return (
    task.title.toLowerCase().includes(query) ||
    formatTaskKey(workspaceKey, task.number).toLowerCase().includes(query)
  );
}

/**
 * NOTE: no `transform`, `filter` or `backdrop-filter` on this section or any
 * ancestor of a Draggable. Each creates a containing block/stacking context,
 * which traps the (position: fixed) dragged card under neighbouring columns.
 *
 * Memoized: after a move, untouched columns keep referential equality in the
 * cache and skip rendering entirely.
 */
export const BoardColumn = memo(function BoardColumn({
  column,
  workspaceKey,
  query,
  collapsed,
  onToggleCollapsed,
  onCreateTask,
}: BoardColumnProps) {
  const [composing, setComposing] = useState(false);
  const headingId = `column-${column.id}-heading`;
  const matchCount = query ? column.tasks.filter((t) => taskMatchesQuery(t, workspaceKey, query)).length : null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onToggleCollapsed(column.id)}
        aria-label={`Expand ${column.name}`}
        className="group flex w-11 shrink-0 flex-col items-center gap-3 rounded-xl border border-hairline bg-surface/60 py-3 transition-all duration-200 hover:border-accent/30 hover:bg-surface"
      >
        <UnfoldHorizontal className="size-3.5 text-zinc-600 transition-colors duration-200 group-hover:text-accent" />
        <ColumnStatusIcon name={column.name} />
        <span className="font-mono text-[11px] text-zinc-500">{column.tasks.length}</span>
        <span className="text-[13px] font-medium text-zinc-300 [writing-mode:vertical-rl]">{column.name}</span>
      </button>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-h-full w-[296px] shrink-0 flex-col rounded-xl border border-hairline bg-surface/60 transition-colors duration-200"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 pl-3 pr-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ColumnStatusIcon name={column.name} />
          <h2 id={headingId} className="truncate text-[13px] font-medium text-zinc-100">
            {column.name}
          </h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-hairline bg-white/[0.03] px-1.5 font-mono text-[10.5px] tabular-nums text-zinc-400">
            {matchCount === null ? column.tasks.length : `${matchCount}/${column.tasks.length}`}
          </span>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label={`Add task to ${column.name}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Plus className="size-4" />
          </button>
          <ColumnMenu
            columnId={column.id}
            columnName={column.name}
            onAddTask={() => setComposing(true)}
            onCollapse={() => onToggleCollapsed(column.id)}
          />
        </div>
      </header>

      <div className="mx-3 h-px bg-gradient-to-r from-hairline-strong via-hairline to-transparent" />

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <ol
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={clsx(
              "scrollbar-thin m-1.5 flex min-h-28 flex-1 flex-col overflow-y-auto rounded-lg p-1.5 transition-all duration-200",
              snapshot.isDraggingOver
                ? "bg-accent/[0.04] ring-1 ring-inset ring-accent/25"
                : "ring-1 ring-inset ring-transparent",
            )}
          >
            {column.tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                workspaceKey={workspaceKey}
                dimmed={!taskMatchesQuery(task, workspaceKey, query)}
              />
            ))}
            {provided.placeholder}

            {column.tasks.length === 0 && !snapshot.isDraggingOver && !composing && (
              <li className="flex flex-1 list-none flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline-strong py-8 text-center">
                <Inbox className="size-4 text-zinc-700" />
                <p className="text-xs text-zinc-600">No tasks</p>
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  className="font-mono text-[10.5px] text-zinc-500 transition-colors duration-200 hover:text-accent"
                >
                  + new task
                </button>
              </li>
            )}

            {composing && (
              <li className="list-none">
                <TaskComposer
                  onSubmit={({ title, priority }) => onCreateTask({ columnId: column.id, title, priority })}
                  onClose={() => setComposing(false)}
                />
              </li>
            )}
          </ol>
        )}
      </Droppable>
    </section>
  );
});
