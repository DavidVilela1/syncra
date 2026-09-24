"use client";

import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { CreateTaskArgs } from "~/hooks/use-create-task";
import type { MoveTaskArgs } from "~/hooks/use-move-task";
import { useTRPC } from "~/trpc/react";
import type { BoardData } from "~/trpc/shared";
import { BoardColumn } from "./board-column";

interface KanbanGridProps {
  board: BoardData;
  query: string;
  moveTask: (args: MoveTaskArgs) => void;
  createTask: (args: CreateTaskArgs) => void;
}

/**
 * Horizontal, scrollable board surface. Translates a dnd drop into the
 * `{ toColumnId, afterTaskId }` intent consumed by the optimistic `useMoveTask`.
 */
export function KanbanGrid({ board, query, moveTask, createTask }: KanbanGridProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const onDragEnd = useCallback(
    ({ draggableId, source, destination }: DropResult) => {
      if (!destination) return;
      if (destination.droppableId === source.droppableId && destination.index === source.index) return;

      // Read the freshest cache (not a render-time closure) to resolve the neighbour.
      const latest = queryClient.getQueryData(trpc.board.byId.queryKey({ boardId: board.id }));
      const column = latest?.columns.find((c) => c.id === destination.droppableId);
      if (!column) return;

      // dnd reports the destination index as if the dragged card were already
      // removed from the list, so exclude it before picking the anchor.
      const siblings = column.tasks.filter((t) => t.id !== draggableId);
      const afterTaskId = destination.index === 0 ? null : (siblings[destination.index - 1]?.id ?? null);

      moveTask({ taskId: draggableId, toColumnId: column.id, afterTaskId });
    },
    [board.id, moveTask, queryClient, trpc],
  );

  // Stable callbacks keep the memoized <BoardColumn/>s from re-rendering.
  const toggleCollapsed = useCallback((columnId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  }, []);

  const onCreateTask = useCallback((args: CreateTaskArgs) => createTask(args), [createTask]);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="scrollbar-thin flex h-full items-start gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-4 md:px-6">
        {board.columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            workspaceKey={board.workspace.key}
            query={query}
            collapsed={collapsed.has(column.id)}
            onToggleCollapsed={toggleCollapsed}
            onCreateTask={onCreateTask}
          />
        ))}
        {/* Trailing spacer so the last column never sits flush against the edge. */}
        <div aria-hidden className="w-px shrink-0" />
      </div>
    </DragDropContext>
  );
}
