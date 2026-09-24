import { TRPCError } from "@trpc/server";
import { boardProcedure, createTRPCRouter } from "~/server/api/trpc";

export const boardRouter = createTRPCRouter({
  /**
   * The full board graph in one round-trip, pre-sorted by fractional key.
   * This output type IS the client cache shape that optimistic updates mutate.
   */
  byId: boardProcedure("read").query(async ({ ctx, input }) => {
    const board = await ctx.db.query.boards.findFirst({
      where: (b, { eq }) => eq(b.id, input.boardId),
      columns: { id: true, name: true, workspaceId: true },
      with: {
        workspace: { columns: { id: true, name: true, key: true } },
        columns: {
          columns: { id: true, name: true, position: true },
          orderBy: (c, { asc }) => [asc(c.position)],
          with: {
            tasks: {
              columns: {
                id: true,
                columnId: true,
                number: true,
                title: true,
                priority: true,
                position: true,
                updatedAt: true,
              },
              orderBy: (t, { asc }) => [asc(t.position)],
            },
          },
        },
      },
    });

    if (!board) throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
    return board;
  }),
});
