import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";
import postgres from "postgres";
import superjson from "superjson";
import { z } from "zod";
import { env } from "~/env";
import { createRedis } from "~/server/redis";
import { boardEventSchemas, type BoardEventMap, type BoardEventName } from "./events";

export type Unsubscribe = () => void;

/**
 * Transport-agnostic, fully typed Pub/Sub for board events.
 *
 * Channels are scoped per board (`TASK_MOVED:<boardId>`) so a server only
 * receives traffic for boards its connected clients actually have open —
 * fan-out cost is proportional to viewers, not to total system activity.
 */
export interface EventBus {
  publish<E extends BoardEventName>(event: E, boardId: string, payload: BoardEventMap[E]): Promise<void>;
  subscribe<E extends BoardEventName>(
    event: E,
    boardId: string,
    handler: (payload: BoardEventMap[E]) => void,
  ): Unsubscribe;
}

const channelOf = (event: BoardEventName, boardId: string): string => `${event}:${boardId}`;

/**
 * Decodes and validates a message that arrived from another process.
 * Returns null (and logs) for anything malformed — the wire is untrusted.
 */
function decode(channel: string, raw: string): BoardEventMap[BoardEventName] | null {
  const event = channel.slice(0, channel.indexOf(":"));
  if (!isBoardEventName(event)) return null;
  const parsed = boardEventSchemas[event].safeParse(superjson.parse(raw));
  if (!parsed.success) {
    console.error(`[event-bus] dropped malformed ${event} message`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

/**
 * Single-process implementation — only correct when publishers and subscribers
 * share one Node process. Mutations run in Next.js and subscriptions in the WS
 * server (two processes), so this is used for tests only; see `getEventBus`.
 */
export class InMemoryEventBus implements EventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    // One listener per open subscription; the default cap of 10 would log
    // spurious "possible memory leak" warnings with >10 viewers on a board.
    this.#emitter.setMaxListeners(0);
  }

  async publish<E extends BoardEventName>(event: E, boardId: string, payload: BoardEventMap[E]) {
    this.#emitter.emit(channelOf(event, boardId), payload);
  }

  subscribe<E extends BoardEventName>(
    event: E,
    boardId: string,
    handler: (payload: BoardEventMap[E]) => void,
  ): Unsubscribe {
    const channel = channelOf(event, boardId);
    const listener = (payload: BoardEventMap[E]) => handler(payload);
    this.#emitter.on(channel, listener);
    return () => {
      this.#emitter.off(channel, listener);
    };
  }
}

/**
 * Horizontally scalable implementation over Redis Pub/Sub.
 *
 * A Redis connection in subscriber mode can't issue other commands, hence two
 * connections. Redis SUBSCRIBEs are reference-counted through a local emitter:
 * the first local listener on a channel subscribes, the last one unsubscribes,
 * so 500 viewers of one board cost exactly one Redis subscription per node.
 */
export class RedisEventBus implements EventBus {
  readonly #pub: Redis;
  readonly #sub: Redis;
  readonly #local = new EventEmitter();

  constructor(url: string) {
    this.#pub = createRedis(url);
    // Subscriber connections must never give up on queued (re)SUBSCRIBEs.
    this.#sub = createRedis(url, { maxRetriesPerRequest: null });
    this.#local.setMaxListeners(0);

    this.#sub.on("message", (channel: string, raw: string) => {
      const payload = decode(channel, raw);
      if (payload) this.#local.emit(channel, payload);
    });
  }

  async publish<E extends BoardEventName>(event: E, boardId: string, payload: BoardEventMap[E]) {
    // superjson preserves Date instances across the wire.
    await this.#pub.publish(channelOf(event, boardId), superjson.stringify(payload));
  }

  subscribe<E extends BoardEventName>(
    event: E,
    boardId: string,
    handler: (payload: BoardEventMap[E]) => void,
  ): Unsubscribe {
    const channel = channelOf(event, boardId);
    const listener = (payload: BoardEventMap[E]) => handler(payload);
    if (this.#local.listenerCount(channel) === 0) {
      this.#sub.subscribe(channel).catch((err: unknown) => {
        console.error(`[event-bus] SUBSCRIBE ${channel} failed`, err);
      });
    }
    this.#local.on(channel, listener);
    return () => {
      this.#local.off(channel, listener);
      if (this.#local.listenerCount(channel) === 0) {
        this.#sub.unsubscribe(channel).catch((err: unknown) => {
          console.error(`[event-bus] UNSUBSCRIBE ${channel} failed`, err);
        });
      }
    };
  }
}

const PG_CHANNEL = "matrix_board_events";
const envelopeSchema = z.object({ channel: z.string().max(128), body: z.string() });

/**
 * Zero-infrastructure cross-process bus over Postgres LISTEN/NOTIFY — the
 * database you already run doubles as the message broker.
 *
 * All events share ONE Postgres channel; each NOTIFY carries an envelope with
 * the logical channel (`TASK_MOVED:<boardId>`) and we demultiplex locally, so a
 * process holds a single LISTEN no matter how many boards it serves.
 *
 * Trade-offs vs Redis: NOTIFY payloads cap at 8000 bytes (our events are
 * <1 KB), and LISTEN needs a session-level connection — use a direct or
 * session-pooler URL (Supabase :5432, Neon non-pooled), not a transaction pooler.
 * postgres.js re-issues LISTEN automatically after a reconnect.
 */
export class PostgresEventBus implements EventBus {
  readonly #sql: postgres.Sql;
  readonly #local = new EventEmitter();
  #listening: Promise<unknown> | null = null;

  constructor(url: string) {
    this.#sql = postgres(url, { max: 2, prepare: false });
    this.#local.setMaxListeners(0);
  }

  /** LISTEN lazily: publisher-only processes (Next.js) never hold a listener connection. */
  #ensureListening(): void {
    this.#listening ??= this.#sql
      .listen(PG_CHANNEL, (raw) => {
        const envelope = envelopeSchema.safeParse(JSON.parse(raw));
        if (!envelope.success) return;
        const payload = decode(envelope.data.channel, envelope.data.body);
        if (payload) this.#local.emit(envelope.data.channel, payload);
      })
      .catch((err: unknown) => {
        this.#listening = null; // allow a retry on the next subscribe
        console.error("[event-bus] LISTEN failed", err);
      });
  }

  async publish<E extends BoardEventName>(event: E, boardId: string, payload: BoardEventMap[E]) {
    const envelope = JSON.stringify({ channel: channelOf(event, boardId), body: superjson.stringify(payload) });
    await this.#sql.notify(PG_CHANNEL, envelope);
  }

  subscribe<E extends BoardEventName>(
    event: E,
    boardId: string,
    handler: (payload: BoardEventMap[E]) => void,
  ): Unsubscribe {
    this.#ensureListening();
    const channel = channelOf(event, boardId);
    const listener = (payload: BoardEventMap[E]) => handler(payload);
    this.#local.on(channel, listener);
    return () => {
      this.#local.off(channel, listener);
    };
  }
}

function isBoardEventName(value: string): value is BoardEventName {
  return Object.hasOwn(boardEventSchemas, value);
}

const globalForBus = globalThis as unknown as { __matrixEventBus?: EventBus };

/**
 * Process-wide singleton (survives Next.js HMR in dev).
 * Redis when REDIS_URL is set (best fan-out at scale), otherwise Postgres
 * LISTEN/NOTIFY — which works out of the box for the Next.js + WS server split.
 */
export function getEventBus(): EventBus {
  if (!globalForBus.__matrixEventBus) {
    const { REDIS_URL, REALTIME_DATABASE_URL, DATABASE_URL } = env();
    globalForBus.__matrixEventBus = REDIS_URL
      ? new RedisEventBus(REDIS_URL)
      : new PostgresEventBus(REALTIME_DATABASE_URL ?? DATABASE_URL);
  }
  return globalForBus.__matrixEventBus;
}
