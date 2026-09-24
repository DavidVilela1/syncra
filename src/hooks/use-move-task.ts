"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { applyTaskPlacement, computeTargetPosition, findTask } from "~/lib/board-cache";
import { getClientId } from "~/trpc/client-id";
import { useTRPC } from "~/trpc/react";
import type { BoardData } from "~/trpc/shared";

export interface MoveTaskArgs {
  taskId: string;
  toColumnId: string;
  /** Task the card is dropped directly below; `null` = top of the column. */
  afterTaskId: string | null;
}

/** What `onMutate` hands to `onError`/`onSettled` for rollback. */
interface MoveTaskSnapshot {
  /** Full board as it was before THIS move. */
  previous: BoardData | undefined;
  /** Just this task's original placement — for surgical rollback. */
  origin: { columnId: string; position: string; updatedAt: Date } | null;
}

/**
 * Optimistic "move card" mutation.
 *
 * Lifecycle of one drag:
 *   onMutate  → cancel in-flight board fetches → snapshot cache → write the move
 *   mutationFn→ network (UI already shows the result)
 *   onSuccess → replace the predicted order key with the server's authoritative one
 *   onError   → roll back to the snapshot
 *   onSettled → resync from the server only after a failure
 */
export function useMoveTask(boardId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const boardKey = trpc.board.byId.queryKey({ boardId });
  const mutationKey = trpc.task.moveTask.mutationKey();

  const mutation = useMutation(
    trpc.task.moveTask.mutationOptions({
      onMutate: async (variables): Promise<MoveTaskSnapshot> => {
        /*
         * 1) CANCEL outgoing refetches FIRST. A board fetch that started before
         *    the drop would otherwise resolve after our optimistic write and
         *    paint the old order back. Order matters: cancelling (revert: true)
         *    restores the query to its pre-fetch state, so it must happen
         *    BEFORE we write, or it would wipe out the optimistic update.
         */
        await queryClient.cancelQueries({ queryKey: boardKey });

        // 2) SNAPSHOT the current cache for rollback.
        const previous = queryClient.getQueryData(boardKey);
        if (!previous) return { previous, origin: null };

        const task = findTask(previous, variables.taskId);
        if (!task) return { previous, origin: null };

        // 3) OPTIMISTIC WRITE. We predict the same fractional key the server
        //    will compute, so the card renders in its final slot immediately.
        //    `updatedAt` is deliberately NOT bumped with the client clock: it is
        //    the row version used to order realtime events, and a skewed local
        //    clock would make us wrongly discard newer peer events.
        const position = computeTargetPosition(previous, variables.taskId, variables.toColumnId, variables.afterTaskId);
        queryClient.setQueryData(
          boardKey,
          applyTaskPlacement(previous, {
            taskId: variables.taskId,
            toColumnId: variables.toColumnId,
            position,
            updatedAt: task.updatedAt,
          }),
        );

        return {
          previous,
          origin: { columnId: task.columnId, position: task.position, updatedAt: task.updatedAt },
        };
      },

      onSuccess: (data) => {
        // Reconcile: the server may have produced a different key (e.g. a peer
        // inserted into the same gap first). Its answer is the truth.
        queryClient.setQueryData(boardKey, (board) =>
          board
            ? applyTaskPlacement(board, {
                taskId: data.task.id,
                toColumnId: data.task.columnId,
                position: data.task.position,
                updatedAt: data.task.updatedAt,
              })
            : board,
        );
      },

      onError: (_error, variables, snapshot) => {
        if (!snapshot?.previous) return;

        /*
         * ROLLBACK. `isMutating` still counts THIS mutation while its callbacks
         * run, so `=== 1` means no other move is in flight.
         *
         *  - Sole mutation → restore the full snapshot (exact pre-drag state).
         *  - Concurrent moves (user dragged card B while card A was in flight)
         *    → restoring A's snapshot would also erase B's optimistic move, so
         *    we surgically put back only this task at its original key.
         */
        const isOnlyMoveInFlight = queryClient.isMutating({ mutationKey }) === 1;
        if (isOnlyMoveInFlight) {
          queryClient.setQueryData(boardKey, snapshot.previous);
          return;
        }
        const { origin } = snapshot;
        if (!origin) return;
        queryClient.setQueryData(boardKey, (board) =>
          board
            ? applyTaskPlacement(board, {
                taskId: variables.taskId,
                toColumnId: origin.columnId,
                position: origin.position,
                updatedAt: origin.updatedAt,
              })
            : board,
        );
      },

      onSettled: (_data, error) => {
        // On success the cache already holds server truth (+ realtime keeps it
        // fresh), so a full board refetch per drag would be wasted bandwidth.
        // After a failure our snapshot may itself be stale (CONFLICT), so
        // resync — once, when the last concurrent move settles.
        if (error && queryClient.isMutating({ mutationKey }) === 1) {
          void queryClient.invalidateQueries({ queryKey: boardKey });
        }
      },
    }),
  );

  const { mutate } = mutation;
  const moveTask = useCallback(
    (args: MoveTaskArgs) => mutate({ ...args, clientId: getClientId() }),
    [mutate],
  );

  return { moveTask, error: mutation.error, isPending: mutation.isPending, reset: mutation.reset };
}
