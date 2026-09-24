import { TRPCError } from "@trpc/server";
import { and, eq, sql, type AnyColumn } from "drizzle-orm";
import type { Database, Transaction } from "~/server/db";
import { boards, columns, tasks, workspaceMembers, workspaces } from "~/server/db/schema";

export type WorkspaceRole = (typeof workspaceMembers.$inferSelect)["role"];
export type AccessMode = "read" | "write";

const WRITE_ROLES: ReadonlySet<WorkspaceRole> = new Set(["owner", "admin", "member"]);

/** Anything a procedure can be scoped to. Each resolves to exactly one workspace. */
export type AccessScope = { workspaceId: string } | { boardId: string } | { columnId: string } | { taskId: string };

export interface Access {
  workspaceId: string;
  /** Set when the scope is a board, column or task. */
  boardId: string | null;
  role: WorkspaceRole;
}

/**
 * Tenant-isolation choke point: resource → workspace → membership in ONE query.
 *
 * The membership is LEFT-joined so we can tell apart:
 *   • resource doesn't exist            → NOT_FOUND
 *   • exists, caller isn't a member     → FORBIDDEN
 *   • member, but role can't write      → FORBIDDEN
 * Resource ids are random UUIDv4s, so distinguishing NOT_FOUND from FORBIDDEN
 * doesn't make ids enumerable.
 */
export async function requireAccess(
  db: Database | Transaction,
  userId: string,
  scope: AccessScope,
  mode: AccessMode,
): Promise<Access> {
  const membership = (workspaceId: AnyColumn) =>
    and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));

  let row: { workspaceId: string; boardId: string | null; role: WorkspaceRole | null } | undefined;

  if ("workspaceId" in scope) {
    [row] = await db
      .select({ workspaceId: workspaces.id, boardId: sql<string | null>`null`, role: workspaceMembers.role })
      .from(workspaces)
      .leftJoin(workspaceMembers, membership(workspaces.id))
      .where(eq(workspaces.id, scope.workspaceId))
      .limit(1);
  } else if ("boardId" in scope) {
    [row] = await db
      .select({ workspaceId: boards.workspaceId, boardId: boards.id, role: workspaceMembers.role })
      .from(boards)
      .leftJoin(workspaceMembers, membership(boards.workspaceId))
      .where(eq(boards.id, scope.boardId))
      .limit(1);
  } else if ("columnId" in scope) {
    [row] = await db
      .select({ workspaceId: boards.workspaceId, boardId: boards.id, role: workspaceMembers.role })
      .from(columns)
      .innerJoin(boards, eq(boards.id, columns.boardId))
      .leftJoin(workspaceMembers, membership(boards.workspaceId))
      .where(eq(columns.id, scope.columnId))
      .limit(1);
  } else {
    [row] = await db
      .select({ workspaceId: boards.workspaceId, boardId: boards.id, role: workspaceMembers.role })
      .from(tasks)
      .innerJoin(boards, eq(boards.id, tasks.boardId))
      .leftJoin(workspaceMembers, membership(boards.workspaceId))
      .where(eq(tasks.id, scope.taskId))
      .limit(1);
  }

  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  if (row.role === null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this workspace" });
  }
  if (mode === "write" && !WRITE_ROLES.has(row.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your role in this workspace is read-only" });
  }
  return { workspaceId: row.workspaceId, boardId: row.boardId, role: row.role };
}
