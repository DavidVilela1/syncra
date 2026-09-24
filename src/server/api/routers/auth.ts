import { signWsTicket } from "~/server/auth/session";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

export const authRouter = createTRPCRouter({
  /**
   * Short-lived credential for the WebSocket handshake (see `signWsTicket`).
   * A mutation, not a query: it must never be cached or deduplicated, and each
   * (re)connect needs a fresh one.
   */
  wsTicket: protectedProcedure.use(rateLimit("auth.wsTicket")).mutation(({ ctx }) => signWsTicket(ctx.session)),
});
