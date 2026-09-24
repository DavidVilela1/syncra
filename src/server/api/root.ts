import { authRouter } from "./routers/auth";
import { boardRouter } from "./routers/board";
import { presenceRouter } from "./routers/presence";
import { taskRouter } from "./routers/task";
import { userRouter } from "./routers/user";
import { workspaceRouter } from "./routers/workspace";
import { createCallerFactory, createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  board: boardRouter,
  task: taskRouter,
  presence: presenceRouter,
  workspace: workspaceRouter,
  user: userRouter,
});

/** The ONLY thing the client imports from the server — as a type. */
export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
