"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { OPTIMISTIC_ID_PREFIX, insertTask, removeTask } from "~/lib/board-cache";
import { generateKeyBetween } from "~/lib/fractional-index";
import { getClientId } from "~/trpc/client-id";
import { useTRPC } from "~/trpc/react";
import type { BoardTask, RouterInputs } from "~/trpc/shared";

type Priority = NonNullable<RouterInputs["task"]["createTask"]["priority"]>;

export interface CreateTaskArgs {
  columnId: string;
  title: string;
  priority?: Priority;
}

/**
 * Optimistic "add card". The card appears instantly with a temporary id and a
 * pending style (drag is disabled for it — the server doesn't know that id yet).
 * On success the temp row is swapped for the real one; on failure only THAT
 * temp row is removed, so concurrent creates/moves are never clobbered.
 */
export function useCreateTask(boardId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const boardKey = trpc.board.byId.queryKey({ boardId });

  const mutation = useMutation(
    trpc.task.createTask.mutationOptions({
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: boardKey });
        const board = queryClient.getQueryData(boardKey);
        const column = board?.columns.find((c) => c.id === variables.columnId);
        if (!board || !column) return { tempId: null };

        const tempId = `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
        const last = column.tasks.at(-1);
        const optimistic: BoardTask = {
          id: tempId,
          columnId: variables.columnId,
          // Real number is allocated server-side; the card renders "SYN-···" meanwhile.
          number: 0,
          title: variables.title,
          priority: variables.priority ?? "none",
          position: generateKeyBetween(last?.position ?? null, null),
          updatedAt: new Date(),
        };
        queryClient.setQueryData(boardKey, insertTask(board, optimistic));
        return { tempId };
      },
      onSuccess: (task, _variables, context) => {
        queryClient.setQueryData(boardKey, (board) => {
          if (!board) return board;
          const withoutTemp = context?.tempId ? removeTask(board, context.tempId) : board;
          return insertTask(withoutTemp, task);
        });
      },
      onError: (_error, _variables, context) => {
        const tempId = context?.tempId;
        if (!tempId) return;
        queryClient.setQueryData(boardKey, (board) => (board ? removeTask(board, tempId) : board));
      },
    }),
  );

  const { mutate } = mutation;
  const createTask = useCallback(
    (args: CreateTaskArgs) => mutate({ ...args, clientId: getClientId() }),
    [mutate],
  );

  return { createTask, error: mutation.error, reset: mutation.reset };
}
