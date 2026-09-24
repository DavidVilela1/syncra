"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useRef } from "react";
import { applyTaskPlacement, findTask, insertTask } from "~/lib/board-cache";
import { getClientId } from "~/trpc/client-id";
import { useTRPC } from "~/trpc/react";

/**
 * Applies peers' card movements directly into the board cache — no refetch.
 * Returns the connection status for a "Live / Reconnecting" indicator.
 */
export function useBoardRealtime(boardId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const boardKey = trpc.board.byId.queryKey({ boardId });
  const hasStartedOnce = useRef(false);

  const subscription = useSubscription(
    trpc.task.onTaskMove.subscriptionOptions(
      { boardId },
      {
        onStarted: () => {
          // Pub/Sub has no replay: events emitted while we were disconnected are
          // gone. On every RE-connect, refetch once to close that gap.
          if (hasStartedOnce.current) void queryClient.invalidateQueries({ queryKey: boardKey });
          hasStartedOnce.current = true;
        },
        onData: (event) => {
          // Our own move was already applied optimistically + reconciled in onSuccess.
          if (event.clientId === getClientId()) return;

          const board = queryClient.getQueryData(boardKey);
          if (!board) return;

          if (!findTask(board, event.task.id)) {
            // A task we've never seen (created after our fetch) — resync.
            void queryClient.invalidateQueries({ queryKey: boardKey });
            return;
          }

          queryClient.setQueryData(
            boardKey,
            applyTaskPlacement(
              board,
              {
                taskId: event.task.id,
                toColumnId: event.task.columnId,
                position: event.task.position,
                updatedAt: event.task.updatedAt,
              },
              // Last-writer-wins: drop events older than the row we hold.
              { ignoreIfStale: true },
            ),
          );
        },
        onError: (error) => {
          console.error("[realtime] onTaskMove subscription error", error);
        },
      },
    ),
  );

  // Peers' new cards stream in with their full payload — inserted in key order, no refetch.
  useSubscription(
    trpc.task.onTaskCreate.subscriptionOptions(
      { boardId },
      {
        onData: (event) => {
          if (event.clientId === getClientId()) return;
          queryClient.setQueryData(boardKey, (board) => (board ? insertTask(board, event.task) : board));
        },
        onError: (error) => {
          console.error("[realtime] onTaskCreate subscription error", error);
        },
      },
    ),
  );

  return { status: subscription.status };
}
