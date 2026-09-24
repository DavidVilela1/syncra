import { compareOrderKeys, generateKeyBetween } from "./fractional-index";

/**
 * Pure, immutable transforms over the cached board graph.
 *
 * Shared by three writers — the optimistic update, the server-confirmed result
 * and the realtime subscription — so all three place a card with identical
 * logic. Being pure (no React, no tRPC) makes them trivially unit-testable.
 *
 * Generic over the task shape so the exact tRPC output type flows through.
 */
export interface TaskLike {
  id: string;
  columnId: string;
  position: string;
  updatedAt: Date;
}
export interface ColumnLike<T extends TaskLike> {
  id: string;
  tasks: T[];
}
export interface BoardLike<T extends TaskLike, C extends ColumnLike<T>> {
  columns: C[];
}

export interface TaskPlacement {
  taskId: string;
  toColumnId: string;
  position: string;
  updatedAt: Date;
}

export function findTask<T extends TaskLike>(
  board: BoardLike<T, ColumnLike<T>>,
  taskId: string,
): T | undefined {
  for (const column of board.columns) {
    const task = column.tasks.find((t) => t.id === taskId);
    if (task) return task;
  }
  return undefined;
}

/**
 * Computes the order key the SERVER will (almost always) assign, so the card
 * lands in the right spot optimistically. Mirrors the server algorithm in
 * `task.moveTask`: lower = anchor key, upper = anchor's successor excluding
 * the moving task.
 */
export function computeTargetPosition<T extends TaskLike>(
  board: BoardLike<T, ColumnLike<T>>,
  taskId: string,
  toColumnId: string,
  afterTaskId: string | null,
): string {
  const column = board.columns.find((c) => c.id === toColumnId);
  if (!column) throw new Error(`Unknown column ${toColumnId}`);
  const siblings = column.tasks.filter((t) => t.id !== taskId);

  const anchorIndex = afterTaskId === null ? -1 : siblings.findIndex((t) => t.id === afterTaskId);
  if (afterTaskId !== null && anchorIndex === -1) throw new Error(`Anchor ${afterTaskId} not in column`);

  const lower = anchorIndex === -1 ? null : (siblings[anchorIndex]?.position ?? null);
  const upper = siblings[anchorIndex + 1]?.position ?? null;
  return generateKeyBetween(lower, upper);
}

/**
 * Returns a new board with the task moved. Only the (at most two) touched
 * columns get new array identities — untouched columns keep referential
 * equality so memoized <Column/> components skip re-rendering.
 *
 * Idempotent and order-independent: re-applying the same placement is a no-op,
 * and a placement older than the cached row (by `updatedAt`) is ignored, which
 * gives last-writer-wins semantics when realtime events arrive out of order.
 */
export function applyTaskPlacement<T extends TaskLike, C extends ColumnLike<T>, B extends BoardLike<T, C>>(
  board: B,
  placement: TaskPlacement,
  options: { ignoreIfStale?: boolean } = {},
): B {
  const existing = findTask(board, placement.taskId);
  if (!existing) return board; // Unknown task (e.g. created after our fetch) — caller may refetch.
  if (options.ignoreIfStale && existing.updatedAt.getTime() > placement.updatedAt.getTime()) return board;
  if (
    existing.columnId === placement.toColumnId &&
    existing.position === placement.position &&
    existing.updatedAt.getTime() === placement.updatedAt.getTime()
  ) {
    return board;
  }

  const moved: T = {
    ...existing,
    columnId: placement.toColumnId,
    position: placement.position,
    updatedAt: placement.updatedAt,
  };

  const columns = board.columns.map((column) => {
    const touchesSource = column.id === existing.columnId;
    const touchesTarget = column.id === placement.toColumnId;
    if (!touchesSource && !touchesTarget) return column;

    let nextTasks = touchesSource ? column.tasks.filter((t) => t.id !== placement.taskId) : column.tasks;
    if (touchesTarget) {
      // Binary-search-free sorted insert: lists are small and already sorted.
      const index = nextTasks.findIndex((t) => compareOrderKeys(t.position, moved.position) > 0);
      nextTasks =
        index === -1 ? [...nextTasks, moved] : [...nextTasks.slice(0, index), moved, ...nextTasks.slice(index)];
    }
    return { ...column, tasks: nextTasks };
  });

  return { ...board, columns };
}

/**
 * Inserts a task in key order. Idempotent: if a task with the same id is
 * already cached (e.g. our own optimistic row was already reconciled, or a
 * realtime echo raced the mutation response), the board is returned unchanged.
 */
export function insertTask<T extends TaskLike, C extends ColumnLike<T>, B extends BoardLike<T, C>>(
  board: B,
  task: T,
): B {
  if (findTask(board, task.id)) return board;
  let inserted = false;
  const columns = board.columns.map((column) => {
    if (column.id !== task.columnId) return column;
    inserted = true;
    const index = column.tasks.findIndex((t) => compareOrderKeys(t.position, task.position) > 0);
    const nextTasks =
      index === -1 ? [...column.tasks, task] : [...column.tasks.slice(0, index), task, ...column.tasks.slice(index)];
    return { ...column, tasks: nextTasks };
  });
  return inserted ? { ...board, columns } : board;
}

/** Removes a task by id (used to roll back an optimistic create). */
export function removeTask<T extends TaskLike, C extends ColumnLike<T>, B extends BoardLike<T, C>>(
  board: B,
  taskId: string,
): B {
  const existing = findTask(board, taskId);
  if (!existing) return board;
  const columns = board.columns.map((column) =>
    column.id === existing.columnId ? { ...column, tasks: column.tasks.filter((t) => t.id !== taskId) } : column,
  );
  return { ...board, columns };
}

/** Temporary ids for optimistically created tasks (never sent to the server). */
export const OPTIMISTIC_ID_PREFIX = "optimistic:";
export const isOptimisticId = (id: string): boolean => id.startsWith(OPTIMISTIC_ID_PREFIX);
