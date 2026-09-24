import { generateNKeysBetween } from "~/lib/fractional-index";
import type { Transaction } from "~/server/db";
import { boards, columns, tasks, type TaskPriority } from "~/server/db/schema";

/**
 * Board content shared by the dev seed and every live demo room, so a visitor
 * lands on a realistic, lived-in board instead of an empty one.
 */
export type SeedTask = readonly [title: string, priority: TaskPriority];
export type SeedBoard = { name: string; columns: ReadonlyArray<{ name: string; tasks: readonly SeedTask[] }> };

export const SEED_BOARDS: readonly SeedBoard[] = [
  {
    name: "Syncra Core",
    columns: [
      {
        name: "Backlog",
        tasks: [
          ["Keyboard-first command palette (⌘K)", "medium"],
          ["Rate-limit tRPC mutations per workspace", "high"],
          ["Audit log for task history", "low"],
          ["Design token audit", "none"],
        ],
      },
      {
        name: "Todo",
        tasks: [
          ["Card detail drawer with markdown editor", "high"],
          ["Invite members via magic link", "medium"],
          ["Column WIP limits", "low"],
        ],
      },
      {
        name: "In Progress",
        tasks: [
          ["Presence avatars over WebSocket", "urgent"],
          ["Optimistic create with rollback", "high"],
        ],
      },
      {
        name: "In Review",
        tasks: [["Redis Pub/Sub fan-out across nodes", "high"]],
      },
      {
        name: "Done",
        tasks: [
          ["Fractional indexing for positions", "medium"],
          ["Drizzle schema + migrations", "low"],
          ["Session cookie shared by HTTP & WS", "medium"],
        ],
      },
    ],
  },
  {
    name: "Design System",
    columns: [
      { name: "Todo", tasks: [["Dark surface elevation scale", "medium"], ["Focus ring tokens", "low"]] },
      { name: "In Progress", tasks: [["Geist type ramp", "high"]] },
      { name: "Done", tasks: [["Icon set on Lucide", "none"]] },
    ],
  },
  {
    name: "Infrastructure",
    columns: [
      { name: "Todo", tasks: [["WS server autoscaling on Fly", "high"], ["Postgres PITR backups", "urgent"]] },
      { name: "In Progress", tasks: [["OpenTelemetry tracing for tRPC", "medium"]] },
      { name: "Done", tasks: [] },
    ],
  },
];

/** Human ids start at SYN-101 so the demo reads like a lived-in project. */
export const FIRST_TASK_NUMBER = 101;

/** Demo rooms get the flagship board only — one room, one board, one shared context. */
export const DEMO_ROOM_BOARD: SeedBoard = SEED_BOARDS[0] ?? { name: "Syncra Core", columns: [] };

/**
 * Inserts a board with its columns and tasks. Keys come from
 * `generateNKeysBetween`, so they're short and evenly spaced from the start.
 * Returns the next free task number for the workspace counter.
 */
export async function insertBoardFromTemplate(
  tx: Transaction,
  opts: { workspaceId: string; template: SeedBoard; firstNumber: number; createdById: string | null; createdAt?: Date },
): Promise<{ boardId: string; nextNumber: number }> {
  const [board] = await tx
    .insert(boards)
    .values({ workspaceId: opts.workspaceId, name: opts.template.name, createdAt: opts.createdAt ?? new Date() })
    .returning({ id: boards.id });
  if (!board) throw new Error("board insert failed");

  let nextNumber = opts.firstNumber;
  const columnKeys = generateNKeysBetween(null, null, opts.template.columns.length);
  for (const [i, columnSpec] of opts.template.columns.entries()) {
    const columnKey = columnKeys[i];
    if (columnKey === undefined) throw new Error("column key generation failed");
    const [column] = await tx
      .insert(columns)
      .values({ boardId: board.id, name: columnSpec.name, position: columnKey })
      .returning({ id: columns.id });
    if (!column) throw new Error("column insert failed");
    if (columnSpec.tasks.length === 0) continue;

    const taskKeys = generateNKeysBetween(null, null, columnSpec.tasks.length);
    await tx.insert(tasks).values(
      columnSpec.tasks.map(([title, priority], j) => {
        const position = taskKeys[j];
        if (position === undefined) throw new Error("task key generation failed");
        return {
          boardId: board.id,
          columnId: column.id,
          number: nextNumber++,
          title,
          priority,
          position,
          createdById: opts.createdById,
        };
      }),
    );
  }
  return { boardId: board.id, nextNumber };
}
