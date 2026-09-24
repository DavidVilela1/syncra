import { observable } from "@trpc/server/observable";
import { boardProcedure, createTRPCRouter } from "~/server/api/trpc";
import { PRESENCE_HEARTBEAT_MS, type PresenceUser } from "~/server/realtime/presence-store";

export const presenceRouter = createTRPCRouter({
  /**
   * Subscribing IS joining: the subscription's lifetime is the presence
   * lifetime. When the socket drops, tRPC runs the teardown → we leave. If the
   * whole node dies, the missing heartbeats expire the entry instead.
   *
   * Emits the full, de-duplicated roster whenever it changes.
   */
  onBoard: boardProcedure("read").subscription(({ ctx, input }) => {
    // `isAuthed` already loaded and validated the user.
    const me = { userId: ctx.user.id, name: ctx.user.name, avatarUrl: ctx.user.avatarUrl };

    const { boardId } = input;
    const connectionId = crypto.randomUUID();
    const { presence, bus } = ctx;

    return observable<PresenceUser[]>((emit) => {
      let closed = false;
      let lastSignature = "";
      const logError = (err: unknown) => console.error("[presence]", err);

      const announce = () => bus.publish("PRESENCE_CHANGED", boardId, { type: "PRESENCE_CHANGED", boardId });

      // Re-read and emit only when the roster actually changed (cheap diff).
      const refresh = async () => {
        const roster = await presence.list(boardId);
        if (closed) return;
        const signature = JSON.stringify(roster.map((u) => [u.userId, u.connections, u.name, u.avatarUrl]));
        if (signature === lastSignature) return;
        lastSignature = signature;
        emit.next(roster);
      };

      const unsubscribe = bus.subscribe("PRESENCE_CHANGED", boardId, () => {
        refresh().catch(logError);
      });

      presence.touch(boardId, connectionId, me).then(announce).then(refresh).catch(logError);

      // Heartbeat keeps our entry alive AND re-lists, so entries left behind by
      // crashed nodes disappear from everyone's avatar stack within the TTL.
      const heartbeat = setInterval(() => {
        presence.touch(boardId, connectionId, me).then(refresh).catch(logError);
      }, PRESENCE_HEARTBEAT_MS);

      return () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        presence.leave(boardId, connectionId).then(announce).catch(logError);
      };
    });
  }),
});
