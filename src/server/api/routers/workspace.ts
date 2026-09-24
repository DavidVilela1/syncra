import { asc, count, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, workspaceProcedure } from "~/server/api/trpc";
import { boards, tasks, workspaceMembers, workspaces } from "~/server/db/schema";

export const workspaceRouter = createTRPCRouter({
  /** Every workspace the viewer belongs to, for the switcher. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, ctx.user.id),
      columns: { role: true },
      with: {
        workspace: {
          columns: { id: true, name: true, key: true },
          with: { boards: { columns: { id: true }, orderBy: [asc(boards.createdAt), asc(boards.name)], limit: 1 } },
        },
      },
    });
    return rows
      .map(({ role, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        key: workspace.key,
        role,
        firstBoardId: workspace.boards[0]?.id ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  /** Sidebar payload: workspace identity + its boards with live task counts. */
  sidebar: workspaceProcedure("read").query(async ({ ctx, input }) => {
    const { access } = ctx;

    const [workspace] = await ctx.db
      .select({ id: workspaces.id, name: workspaces.name, key: workspaces.key })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);

    const boardRows = await ctx.db
      .select({ id: boards.id, name: boards.name, taskCount: count(tasks.id) })
      .from(boards)
      .leftJoin(tasks, eq(tasks.boardId, boards.id))
      .where(eq(boards.workspaceId, input.workspaceId))
      .groupBy(boards.id)
      .orderBy(asc(boards.createdAt), asc(boards.name));

    // The membership row proves the workspace exists; this is unreachable in practice.
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} vanished`);
    return { workspace, role: access.role, boards: boardRows };
  }),
});
