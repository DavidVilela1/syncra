import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  /** `isAuthed` has already loaded (and verified the existence of) the user. */
  me: protectedProcedure.query(({ ctx }) => ctx.user),
});
