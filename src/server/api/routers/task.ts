import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { generateKeyBetween } from "~/lib/fractional-index";
import { PG_DEADLOCK_DETECTED, PG_SERIALIZATION_FAILURE, PG_UNIQUE_VIOLATION, pgErrorCode } from "~/server/api/errors";
import {
  boardIdOf,
  boardProcedure,
  columnProcedure,
  createTRPCRouter,
  rateLimit,
  taskProcedure,
} from "~/server/api/trpc";
import { TASK_PRIORITIES, columns, tasks, workspaces } from "~/server/db/schema";
import type { TaskCreatedEvent, TaskMovedEvent } from "~/server/realtime/events";

/**
 * The client describes WHERE the card goes relative to its neighbours, not the
 * raw order key. The server derives the authoritative key from the *current*
 * database state, so two users dragging simultaneously on stale screens can't
 * write keys that break ordering. The client still computes the same key
 * locally for the optimistic render; the server's answer replaces it.
 */
export const moveTaskInput = z.object({
  taskId: z.uuid(),
  toColumnId: z.uuid(),
  /** Place the task directly after this task; `null` = top of the column. */
  afterTaskId: z.uuid().nullable(),
  /** Per-tab id used to suppress this tab's own realtime echo. */
  clientId: z.string().min(1).max(64),
});
export type MoveTaskInput = z.infer<typeof moveTaskInput>;

export const createTaskInput = z.object({
  columnId: z.uuid(),
  title: z.string().trim().min(1, "Title is required").max(256),
  priority: z.enum(TASK_PRIORITIES).default("none"),
  clientId: z.string().min(1).max(64),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const taskRouter = createTRPCRouter({
  /**
   * Middleware chain (outer → inner):
   *   isAuthed → taskProcedure("write") [tenant + role check] → rateLimit("task.move")
   * Authorization runs before rate limiting so a non-member can't drain a
   * member's budget, and every rejection happens before a transaction opens.
   */
  moveTask: taskProcedure("write")
    .use(rateLimit("task.move"))
    .input(moveTaskInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const boardId = boardIdOf(ctx.access);
      if (input.afterTaskId === input.taskId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A task cannot be placed after itself" });
      }

      let result: {
        moved: boolean;
        boardId: string;
        fromColumnId: string;
        task: { id: string; columnId: string; position: string; updatedAt: Date };
      };

      try {
        result = await ctx.db.transaction(async (tx) => {
          /*
           * Serialize concurrent writers into the SAME destination column by
           * locking the column row. Without this, two users dropping into the same
           * gap would both compute key K between the same neighbours. Lock order
           * is always (column → task), so concurrent moves can't deadlock.
           * Moves into *different* columns never block each other.
           */
          const [target] = await tx
            .select({ id: columns.id })
            .from(columns)
            .where(and(eq(columns.id, input.toColumnId), eq(columns.boardId, boardId)))
            .for("update");
          if (!target) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Target column is not on this board" });
          }

          const [task] = await tx
            .select({ id: tasks.id, columnId: tasks.columnId, position: tasks.position, updatedAt: tasks.updatedAt })
            .from(tasks)
            .where(eq(tasks.id, input.taskId))
            .for("update");
          if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

          // Lower bound: the anchor's key (or null = start of column).
          let lower: string | null = null;
          if (input.afterTaskId !== null) {
            const [anchor] = await tx
              .select({ position: tasks.position })
              .from(tasks)
              .where(and(eq(tasks.id, input.afterTaskId), eq(tasks.columnId, input.toColumnId)));
            if (!anchor) {
              // The client's view is stale (anchor moved/deleted). CONFLICT tells
              // it to roll back and resync rather than guessing a location.
              throw new TRPCError({ code: "CONFLICT", message: "The board changed — please retry" });
            }
            lower = anchor.position;
          }

          // Upper bound: the anchor's current successor, excluding the moving task
          // itself. Served by the (column_id, position) index as a single seek.
          const [successor] = await tx
            .select({ position: tasks.position })
            .from(tasks)
            .where(
              and(
                eq(tasks.columnId, input.toColumnId),
                ne(tasks.id, input.taskId),
                lower === null ? undefined : gt(tasks.position, lower),
              ),
            )
            .orderBy(asc(tasks.position))
            .limit(1);
          const upper = successor?.position ?? null;

          const alreadyThere =
            task.columnId === input.toColumnId &&
            (lower === null || task.position > lower) &&
            (upper === null || task.position < upper);
          if (alreadyThere) {
            return { moved: false, boardId, fromColumnId: task.columnId, task };
          }

          const position = generateKeyBetween(lower, upper);
          const [updated] = await tx
            .update(tasks)
            .set({ columnId: input.toColumnId, position, updatedAt: new Date() })
            .where(eq(tasks.id, input.taskId))
            .returning({
              id: tasks.id,
              columnId: tasks.columnId,
              position: tasks.position,
              updatedAt: tasks.updatedAt,
            });
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

          return { moved: true, boardId, fromColumnId: task.columnId, task: updated };
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const code = pgErrorCode(err);
        if (code === PG_UNIQUE_VIOLATION || code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) {
          throw new TRPCError({ code: "CONFLICT", message: "Concurrent edit — please retry", cause: err });
        }
        throw err;
      }

      /*
       * Publish only AFTER the transaction commits. Publishing inside it would let
       * a subscriber react (e.g. refetch) before the row is visible, or broadcast
       * a move that later rolls back. A broken bus must not fail a committed write:
       * peers self-heal on their next refetch, so we log instead of throwing.
       */
      if (result.moved) {
        const event: TaskMovedEvent = {
          type: "TASK_MOVED",
          boardId: result.boardId,
          task: { ...result.task, fromColumnId: result.fromColumnId },
          actorId: userId,
          clientId: input.clientId,
        };
        await ctx.bus.publish("TASK_MOVED", result.boardId, event).catch((err: unknown) => {
          console.error("[moveTask] failed to publish TASK_MOVED", err);
        });
      }

      return { moved: result.moved, task: result.task };
    }),

  /**
   * Appends a task to the bottom of a column and allocates its human id
   * (SYN-<n>) from the workspace counter — both inside one transaction.
   */
  createTask: columnProcedure("write")
    .use(rateLimit("task.create"))
    .input(createTaskInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const boardId = boardIdOf(ctx.access);
      const { workspaceId } = ctx.access;

      const created = await ctx.db
        .transaction(async (tx) => {
          // Same lock as moveTask: serializes writers computing a key at this column's tail.
          await tx.select({ id: columns.id }).from(columns).where(eq(columns.id, input.columnId)).for("update");

          // Atomic per-tenant counter; the row lock makes numbers unique and gap-free.
          const [seq] = await tx
            .update(workspaces)
            .set({ taskSeq: sql`${workspaces.taskSeq} + 1` })
            .where(eq(workspaces.id, workspaceId))
            .returning({ number: workspaces.taskSeq });
          if (!seq) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

          const [last] = await tx
            .select({ position: tasks.position })
            .from(tasks)
            .where(eq(tasks.columnId, input.columnId))
            .orderBy(desc(tasks.position))
            .limit(1);

          const [task] = await tx
            .insert(tasks)
            .values({
              boardId,
              columnId: input.columnId,
              number: seq.number,
              title: input.title,
              priority: input.priority,
              position: generateKeyBetween(last?.position ?? null, null),
              createdById: userId,
            })
            .returning({
              id: tasks.id,
              columnId: tasks.columnId,
              number: tasks.number,
              title: tasks.title,
              priority: tasks.priority,
              position: tasks.position,
              updatedAt: tasks.updatedAt,
            });
          if (!task) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert failed" });
          return { boardId, task };
        })
        .catch((err: unknown) => {
          if (err instanceof TRPCError) throw err;
          const code = pgErrorCode(err);
          if (code === PG_UNIQUE_VIOLATION || code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) {
            throw new TRPCError({ code: "CONFLICT", message: "Concurrent edit — please retry", cause: err });
          }
          throw err;
        });

      const event: TaskCreatedEvent = {
        type: "TASK_CREATED",
        boardId: created.boardId,
        task: created.task,
        actorId: userId,
        clientId: input.clientId,
      };
      await ctx.bus.publish("TASK_CREATED", created.boardId, event).catch((err: unknown) => {
        console.error("[createTask] failed to publish TASK_CREATED", err);
      });

      return created.task;
    }),

  onTaskCreate: boardProcedure("read").subscription(({ ctx, input }) => {
    return observable<TaskCreatedEvent>((emit) =>
      ctx.bus.subscribe("TASK_CREATED", input.boardId, (event) => {
        emit.next(event);
      }),
    );
  }),

  /**
   * Streams every card movement on a board to connected clients.
   * Authorization runs once at subscribe time; the channel is board-scoped so
   * a subscriber can never receive another tenant's events.
   */
  onTaskMove: boardProcedure("read").subscription(({ ctx, input }) => {
    return observable<TaskMovedEvent>((emit) => {
      const unsubscribe = ctx.bus.subscribe("TASK_MOVED", input.boardId, (event) => {
        emit.next(event);
      });
      // Teardown runs when the client unsubscribes or the socket drops.
      return unsubscribe;
    });
  }),
});
