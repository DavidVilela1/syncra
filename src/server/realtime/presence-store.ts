import type { Redis } from "ioredis";
import { z } from "zod";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { env } from "~/env";
import type { Database } from "~/server/db";
import { presenceConnections } from "~/server/db/schema";
import { createRedis } from "~/server/redis";

/**
 * Who is looking at a board right now.
 *
 * Presence is keyed by CONNECTION (one per open tab/socket), not by user, and
 * collapsed to users only when listed. That way closing one of two tabs doesn't
 * make you "go offline", and a crashed node's connections simply expire.
 */
export interface PresenceMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface PresenceUser extends PresenceMember {
  /** Open connections (tabs/devices) this user has on the board. */
  connections: number;
  /** Earliest join — gives the avatar stack a stable order. */
  since: number;
}

export interface PresenceStore {
  /** Registers or refreshes (heartbeat) a connection. */
  touch(boardId: string, connectionId: string, member: PresenceMember): Promise<void>;
  leave(boardId: string, connectionId: string): Promise<void>;
  list(boardId: string): Promise<PresenceUser[]>;
}

/**
 * Two independent clean-up paths keep the avatar stack honest:
 *  1. Ghost CLIENT (laptop lid closed, network gone): the WS keep-alive kills
 *     the socket after ≤10s of silence → subscription teardown → `leave()`
 *     → everyone is notified immediately.
 *  2. Dead SERVER NODE (crash, OOM, kill -9): nobody runs teardown, so its
 *     entries simply stop being refreshed and expire after PRESENCE_TTL_MS.
 *     Surviving subscribers re-list on every heartbeat, so they notice within
 *     TTL + one heartbeat ≈ 14s worst case.
 * TTL = 2.5 × heartbeat tolerates one delayed beat without flapping.
 */
export const PRESENCE_HEARTBEAT_MS = 4_000;
export const PRESENCE_TTL_MS = 10_000;

const entrySchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.number(),
  seenAt: z.number(),
});
type Entry = z.infer<typeof entrySchema>;

function collapse(entries: Iterable<Entry>, now: number): PresenceUser[] {
  const byUser = new Map<string, PresenceUser>();
  for (const e of entries) {
    if (now - e.seenAt > PRESENCE_TTL_MS) continue;
    const existing = byUser.get(e.userId);
    if (existing) {
      existing.connections += 1;
      existing.since = Math.min(existing.since, e.joinedAt);
    } else {
      byUser.set(e.userId, {
        userId: e.userId,
        name: e.name,
        avatarUrl: e.avatarUrl,
        connections: 1,
        since: e.joinedAt,
      });
    }
  }
  return [...byUser.values()].sort((a, b) => a.since - b.since || a.userId.localeCompare(b.userId));
}

export class InMemoryPresenceStore implements PresenceStore {
  readonly #boards = new Map<string, Map<string, Entry>>();

  async touch(boardId: string, connectionId: string, member: PresenceMember) {
    const now = Date.now();
    let board = this.#boards.get(boardId);
    if (!board) {
      board = new Map();
      this.#boards.set(boardId, board);
    }
    const prev = board.get(connectionId);
    board.set(connectionId, { ...member, joinedAt: prev?.joinedAt ?? now, seenAt: now });
  }

  async leave(boardId: string, connectionId: string) {
    const board = this.#boards.get(boardId);
    if (!board) return;
    board.delete(connectionId);
    if (board.size === 0) this.#boards.delete(boardId);
  }

  async list(boardId: string) {
    const board = this.#boards.get(boardId);
    if (!board) return [];
    const now = Date.now();
    for (const [id, e] of board) if (now - e.seenAt > PRESENCE_TTL_MS) board.delete(id);
    return collapse(board.values(), now);
  }
}

/**
 * One Redis hash per board: field = connectionId, value = JSON entry. The whole
 * key also gets a TTL, so a board nobody watches anymore cleans itself up.
 */
export class RedisPresenceStore implements PresenceStore {
  readonly #redis: Redis;

  constructor(url: string) {
    this.#redis = createRedis(url);
  }

  #key(boardId: string) {
    return `presence:${boardId}`;
  }

  async touch(boardId: string, connectionId: string, member: PresenceMember) {
    const key = this.#key(boardId);
    const now = Date.now();
    const prevRaw = await this.#redis.hget(key, connectionId);
    const prev = prevRaw ? entrySchema.safeParse(JSON.parse(prevRaw)) : null;
    const entry: Entry = { ...member, joinedAt: prev?.success ? prev.data.joinedAt : now, seenAt: now };
    await this.#redis
      .multi()
      .hset(key, connectionId, JSON.stringify(entry))
      .pexpire(key, PRESENCE_TTL_MS * 2)
      .exec();
  }

  async leave(boardId: string, connectionId: string) {
    await this.#redis.hdel(this.#key(boardId), connectionId);
  }

  async list(boardId: string) {
    const key = this.#key(boardId);
    const raw = await this.#redis.hgetall(key);
    const now = Date.now();
    const live: Entry[] = [];
    const expired: string[] = [];
    for (const [connectionId, json] of Object.entries(raw)) {
      const parsed = entrySchema.safeParse(JSON.parse(json));
      if (!parsed.success || now - parsed.data.seenAt > PRESENCE_TTL_MS) expired.push(connectionId);
      else live.push(parsed.data);
    }
    // Opportunistic GC of connections from crashed/partitioned nodes.
    if (expired.length > 0) await this.#redis.hdel(key, ...expired);
    return collapse(live, now);
  }
}

/**
 * Default store when REDIS_URL is unset. Shared by every process through the
 * database, which matters for demo rooms: the Next.js app reads presence to
 * decide which persona seat is free, while the WS server writes it.
 * One small UPSERT per connection every heartbeat (4s) — trivial for Postgres.
 */
export class PostgresPresenceStore implements PresenceStore {
  constructor(private readonly db: Database) {}

  async touch(boardId: string, connectionId: string, member: PresenceMember) {
    await this.db
      .insert(presenceConnections)
      .values({ connectionId, boardId, userId: member.userId, name: member.name, avatarUrl: member.avatarUrl })
      .onConflictDoUpdate({
        target: presenceConnections.connectionId,
        set: { seenAt: sql`now()`, name: member.name, avatarUrl: member.avatarUrl },
      });
  }

  async leave(_boardId: string, connectionId: string) {
    await this.db.delete(presenceConnections).where(eq(presenceConnections.connectionId, connectionId));
  }

  async list(boardId: string) {
    const rows = await this.db
      .select({
        userId: presenceConnections.userId,
        name: presenceConnections.name,
        avatarUrl: presenceConnections.avatarUrl,
        joinedAt: presenceConnections.joinedAt,
        seenAt: presenceConnections.seenAt,
      })
      .from(presenceConnections)
      .where(
        and(
          eq(presenceConnections.boardId, boardId),
          // Server-side clock for both sides of the comparison → immune to app/DB clock skew.
          gt(presenceConnections.seenAt, sql`now() - make_interval(secs => ${PRESENCE_TTL_MS / 1000})`),
        ),
      );
    const now = Date.now();
    // Rows are already TTL-filtered by the database; normalise seenAt so `collapse` keeps them.
    return collapse(
      rows.map((r) => ({
        userId: r.userId,
        name: r.name,
        avatarUrl: r.avatarUrl,
        joinedAt: r.joinedAt.getTime(),
        seenAt: now,
      })),
      now,
    );
  }

  /** Deletes rows left behind by crashed nodes. Called by the maintenance job. */
  static async purgeStale(db: Database, olderThanMs: number): Promise<number> {
    const deleted = await db
      .delete(presenceConnections)
      .where(lt(presenceConnections.seenAt, sql`now() - make_interval(secs => ${olderThanMs / 1000})`))
      .returning({ id: presenceConnections.connectionId });
    return deleted.length;
  }
}

const globalForPresence = globalThis as unknown as { __matrixPresence?: PresenceStore };

/**
 * Redis when configured (fastest, TTL-native), otherwise Postgres. The
 * in-memory store remains for unit tests — it's invisible across processes.
 */
export function getPresenceStore(db: Database): PresenceStore {
  if (!globalForPresence.__matrixPresence) {
    const { REDIS_URL } = env();
    globalForPresence.__matrixPresence = REDIS_URL ? new RedisPresenceStore(REDIS_URL) : new PostgresPresenceStore(db);
  }
  return globalForPresence.__matrixPresence;
}
