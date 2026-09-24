import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Fractional-index order key (see ~/lib/fractional-index.ts).
 *
 * Declared as `text COLLATE "C"` so Postgres compares keys byte-by-byte, exactly
 * like JavaScript's `<`. With a locale collation (e.g. en_US.UTF-8) "a0" vs "Z1"
 * could sort differently in SQL than in the client, silently breaking ORDER BY
 * and the neighbour lookups in `moveTask`.
 */
const orderKey = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text COLLATE "C"';
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);

/** Linear-style priority scale. Order matters: it is the enum's sort order in Postgres. */
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const taskPriority = pgEnum("task_priority", TASK_PRIORITIES);
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/* ───────────────────────────── Identity ───────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  avatarUrl: text("avatar_url"),
  /**
   * Set for ephemeral demo identities. Deleting the room cascades to its users,
   * so a purged room leaves nothing behind.
   */
  demoRoomId: varchar("demo_room_id", { length: 16 }).references((): AnyPgColumn => demoRooms.id, {
    onDelete: "cascade",
  }),
  ...timestamps,
});

/* ─────────────────────── Tenancy (isolation root) ─────────────────────── */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  /** Human task-id prefix, e.g. "SYN" → SYN-102. */
  key: varchar("key", { length: 10 }).notNull(),
  /**
   * Per-workspace task counter. `UPDATE … SET task_seq = task_seq + 1 RETURNING`
   * takes a row lock, so concurrent creates get gap-free, unique numbers without
   * a global sequence (which would leak across tenants).
   */
  taskSeq: integer("task_seq").notNull().default(0),
  ...timestamps,
});

/** Every authorization check resolves to a row here: "is user U a member of workspace W?" */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

/* ───────────────────────────── Board graph ───────────────────────────── */

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    ...timestamps,
  },
  (t) => [index("boards_workspace_idx").on(t.workspaceId)],
);

export const columns = pgTable(
  "columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    position: orderKey("position").notNull(),
    ...timestamps,
  },
  (t) => [
    // Serves `ORDER BY position` per board AND guarantees two columns can never
    // share a key (a concurrent-insert collision surfaces as a 23505 → CONFLICT).
    uniqueIndex("columns_board_position_uq").on(t.boardId, t.position),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalized from column → board so realtime fan-out and authz need no join. */
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    /** Workspace-scoped human number (SYN-<number>), allocated from workspaces.task_seq. */
    number: integer("number").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    position: orderKey("position").notNull(),
    priority: taskPriority("priority").notNull().default("none"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // Composite (column_id, position) index: the ONLY access path `moveTask`
    // needs — "first task in column C with position > K" is an index seek.
    uniqueIndex("tasks_column_position_uq").on(t.columnId, t.position),
    index("tasks_board_idx").on(t.boardId),
  ],
);

/* ───────────────────────────── Live demo rooms ───────────────────────────── */

/**
 * A shareable, self-contained sandbox: its own workspace, one board and a fixed
 * cast of persona users. The short public id doubles as the invite token, so
 * it's generated from 50 bits of CSPRNG entropy (see server/demo/room-id.ts).
 */
export const demoRooms = pgTable(
  "demo_rooms",
  {
    id: varchar("id", { length: 16 }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Sliding expiry: every successful join pushes it forward. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("demo_rooms_expires_idx").on(t.expiresAt)],
);

/**
 * One row per persona slot. `claimedAt` is a short LEASE: it holds a seat
 * between "identity assigned" and "WebSocket connected", after which live
 * presence is the source of truth for who is in the room.
 */
export const demoRoomSeats = pgTable(
  "demo_room_seats",
  {
    roomId: varchar("room_id", { length: 16 })
      .notNull()
      .references(() => demoRooms.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.slot] })],
);

/**
 * Presence store for deployments WITHOUT Redis. Living in Postgres (rather
 * than process memory) makes it visible to every process — the Next.js app
 * reads it to decide which demo seat is free, while the WS server writes it.
 */
export const presenceConnections = pgTable(
  "presence_connections",
  {
    connectionId: uuid("connection_id").primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    avatarUrl: text("avatar_url"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("presence_board_seen_idx").on(t.boardId, t.seenAt)],
);

/* ───────────────────────────── Relations ───────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  boards: many(boards),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [boards.workspaceId], references: [workspaces.id] }),
  columns: many(columns),
  tasks: many(tasks),
}));

export const columnsRelations = relations(columns, ({ one, many }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  board: one(boards, { fields: [tasks.boardId], references: [boards.id] }),
  column: one(columns, { fields: [tasks.columnId], references: [columns.id] }),
  createdBy: one(users, { fields: [tasks.createdById], references: [users.id] }),
}));

/* ───────────────────────────── Row types ───────────────────────────── */

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type DemoRoom = typeof demoRooms.$inferSelect;
