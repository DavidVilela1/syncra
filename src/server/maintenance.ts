import { sql } from "drizzle-orm";
import type { Database } from "~/server/db";
import { purgeExpiredDemoRooms } from "~/server/demo/rooms";
import { PRESENCE_TTL_MS, PostgresPresenceStore } from "~/server/realtime/presence-store";

/** Arbitrary app-wide constant: "only one maintenance run at a time, cluster-wide". */
const MAINTENANCE_LOCK_ID = 7_243_118;
const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Periodic clean-up, run by the WS server(s):
 *  • expired demo rooms (and everything they own, via FK cascades)
 *  • presence rows left behind by crashed nodes (Postgres presence mode)
 *
 * `pg_try_advisory_xact_lock` makes it safe to run on every instance: the
 * first one to wake up does the work, the others skip instantly. The lock is
 * transaction-scoped, so it's released even if the process dies mid-run.
 */
export async function runMaintenance(db: Database): Promise<{ skipped: boolean; rooms: number; presence: number }> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(${MAINTENANCE_LOCK_ID}) as acquired`,
    );
    if (!lock?.acquired) return { skipped: true, rooms: 0, presence: 0 };
    const rooms = await purgeExpiredDemoRooms(tx);
    const presence = await PostgresPresenceStore.purgeStale(tx, PRESENCE_TTL_MS * 6);
    return { skipped: false, rooms, presence };
  });
}

export function startMaintenance(db: Database): () => void {
  const tick = () => {
    runMaintenance(db)
      .then((r) => {
        if (!r.skipped && (r.rooms > 0 || r.presence > 0)) {
          console.log(`[maintenance] purged ${r.rooms} expired demo room(s), ${r.presence} stale presence row(s)`);
        }
      })
      .catch((err: unknown) => console.error("[maintenance] run failed", err));
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
