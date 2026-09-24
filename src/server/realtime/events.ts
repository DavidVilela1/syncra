import { z } from "zod";
import { TASK_PRIORITIES } from "~/server/db/schema";

/**
 * Wire contract for realtime board events.
 *
 * Every event is validated with Zod when it comes OFF the wire (Redis), because
 * a message on a shared Pub/Sub channel is untrusted input like any request body.
 */
export const taskMovedEventSchema = z.object({
  type: z.literal("TASK_MOVED"),
  boardId: z.uuid(),
  task: z.object({
    id: z.uuid(),
    columnId: z.uuid(),
    fromColumnId: z.uuid(),
    position: z.string().min(1),
    /** Row version: clients drop events older than what they already hold (LWW). */
    updatedAt: z.coerce.date(),
  }),
  actorId: z.uuid(),
  /**
   * Opaque id of the browser tab that initiated the change. The originating tab
   * already applied it optimistically, so it ignores its own echo.
   */
  clientId: z.string().min(1).max(64),
});

/** Carries the full card so peers can render it without a refetch. */
export const taskCreatedEventSchema = z.object({
  type: z.literal("TASK_CREATED"),
  boardId: z.uuid(),
  task: z.object({
    id: z.uuid(),
    columnId: z.uuid(),
    number: z.number().int().positive(),
    title: z.string().min(1),
    priority: z.enum(TASK_PRIORITIES),
    position: z.string().min(1),
    updatedAt: z.coerce.date(),
  }),
  actorId: z.uuid(),
  clientId: z.string().min(1).max(64),
});

/**
 * A "roster changed" ping only — no payload. Each subscriber re-reads the
 * roster from the PresenceStore, so a lost ping can never leave a client with
 * a permanently wrong list (the next heartbeat re-reads it anyway).
 */
export const presenceChangedEventSchema = z.object({
  type: z.literal("PRESENCE_CHANGED"),
  boardId: z.uuid(),
});

export type TaskMovedEvent = z.infer<typeof taskMovedEventSchema>;
export type TaskCreatedEvent = z.infer<typeof taskCreatedEventSchema>;
export type PresenceChangedEvent = z.infer<typeof presenceChangedEventSchema>;

/** Registry of event name → payload schema. Add new board events here. */
export const boardEventSchemas = {
  TASK_MOVED: taskMovedEventSchema,
  TASK_CREATED: taskCreatedEventSchema,
  PRESENCE_CHANGED: presenceChangedEventSchema,
} as const;

export type BoardEventMap = {
  [K in keyof typeof boardEventSchemas]: z.infer<(typeof boardEventSchemas)[K]>;
};
export type BoardEventName = keyof BoardEventMap;
