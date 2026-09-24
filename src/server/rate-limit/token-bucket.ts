import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import { env } from "~/env";
import { createRedis } from "~/server/redis";

/**
 * Token-bucket rate limiting.
 *
 * WHY a token bucket (not a fixed window): Kanban traffic is bursty by nature —
 * a user reorganising a column fires 10 moves in two seconds, then nothing for
 * a minute. A bucket allows that burst (up to `capacity`) while still capping
 * the sustained rate (`refillPerSecond`). A fixed window would either block
 * legitimate bursts or, at the window edge, let through 2× the limit.
 */
export interface RateLimitPolicy {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained rate: tokens restored per second. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Whole tokens left after this request. */
  remaining: number;
  /** When `allowed` is false: how long until enough tokens exist. */
  retryAfterMs: number;
  limit: number;
}

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy, cost?: number): Promise<RateLimitResult>;
}

/** Central catalogue — every limit in the system is visible (and tunable) in one place. */
export const RATE_LIMIT_POLICIES = {
  /** Per user. 30-move burst for fast reorganising, 5/s sustained. */
  "task.move": { capacity: 30, refillPerSecond: 5 },
  /** Per user. 15-card burst (pasting a checklist), then 1 every 2s. */
  "task.create": { capacity: 15, refillPerSecond: 0.5 },
  /** Per user. WS ticket minting — one per (re)connect, so this is generous. */
  "auth.wsTicket": { capacity: 30, refillPerSecond: 1 },
  /** Per IP. Each room provisions ~20 rows, so creation is the most expensive public action. */
  "demo.create": { capacity: 10, refillPerSecond: 1 / 60 },
  /** Per IP. Joining an existing room (seat assignment). */
  "demo.join": { capacity: 30, refillPerSecond: 0.5 },
  /** Per IP. WebSocket handshakes — stops reconnect storms and scanners. */
  "ws.connect": { capacity: 20, refillPerSecond: 0.5 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/** Thrown as the `cause` of a TOO_MANY_REQUESTS TRPCError so formatters can read the retry hint. */
export class RateLimitError extends Error {
  override readonly name = "RateLimitError";
  constructor(readonly result: RateLimitResult) {
    super(`Rate limit exceeded; retry in ${result.retryAfterMs}ms`);
  }
}

/* ───────────────────────────── In-memory ───────────────────────────── */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Single-process bucket store — used when REDIS_URL is unset.
 *
 * Limits are per PROCESS: with N app instances a user effectively gets N×
 * the budget. That is the honest trade-off of zero-infrastructure mode; set
 * REDIS_URL for a globally consistent limit.
 */
export class InMemoryTokenBucket implements RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;
  readonly #maxKeys: number;

  constructor(options: { now?: () => number; maxKeys?: number; sweepIntervalMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxKeys = options.maxKeys ?? 100_000;
    const sweepMs = options.sweepIntervalMs ?? 60_000;
    if (sweepMs > 0) {
      // A bucket that has refilled completely is indistinguishable from a
      // missing one, so dropping it is free. `unref` keeps tests/CLI exiting.
      setInterval(() => this.#sweep(), sweepMs).unref();
    }
  }

  async consume(key: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitResult> {
    return this.consumeSync(key, policy, cost);
  }

  consumeSync(key: string, policy: RateLimitPolicy, cost = 1): RateLimitResult {
    const now = this.#now();
    const existing = this.#buckets.get(key);
    const refillPerMs = policy.refillPerSecond / 1000;

    let tokens = policy.capacity;
    if (existing) {
      tokens = Math.min(policy.capacity, existing.tokens + Math.max(0, now - existing.updatedAt) * refillPerMs);
      // Re-insert to move the key to the "most recently used" end of the Map.
      this.#buckets.delete(key);
    } else if (this.#buckets.size >= this.#maxKeys) {
      // Hard memory bound: evict the least-recently-used bucket (Map keeps insertion order).
      const oldest = this.#buckets.keys().next();
      if (!oldest.done) this.#buckets.delete(oldest.value);
    }

    const allowed = tokens >= cost;
    if (allowed) tokens -= cost;
    this.#buckets.set(key, { tokens, updatedAt: now });

    return {
      allowed,
      remaining: Math.floor(tokens),
      retryAfterMs: allowed ? 0 : Math.ceil((cost - tokens) / refillPerMs),
      limit: policy.capacity,
    };
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, bucket] of this.#buckets) {
      // Without the policy we can't know capacity; 10 minutes idle refills every policy above.
      if (now - bucket.updatedAt > 10 * 60_000) this.#buckets.delete(key);
    }
  }
}

/* ───────────────────────────── Redis ───────────────────────────── */

/**
 * Read-refill-consume-write in ONE atomic Lua script: no race between two app
 * instances checking the same bucket. Uses Redis' own clock (`TIME`) so app
 * servers with skewed clocks can't mint extra tokens.
 * Token counts are returned as strings because Lua→Redis truncates numbers to integers.
 */
const TOKEN_BUCKET_LUA = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local t   = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local state  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

tokens = math.min(capacity, tokens + math.max(0, now - ts) * refill)

local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / refill)
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, ttl)
return { allowed, tostring(tokens), retry }
`;

const TOKEN_BUCKET_SHA = createHash("sha1").update(TOKEN_BUCKET_LUA).digest("hex");
const luaReplySchema = z.tuple([z.number(), z.string(), z.number()]);

export class RedisTokenBucket implements RateLimiter {
  readonly #redis: Redis;
  readonly #prefix: string;

  constructor(redisOrUrl: Redis | string, prefix = "ratelimit:") {
    this.#redis = typeof redisOrUrl === "string" ? createRedis(redisOrUrl, { maxRetriesPerRequest: 2 }) : redisOrUrl;
    this.#prefix = prefix;
  }

  async consume(key: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitResult> {
    const refillPerMs = policy.refillPerSecond / 1000;
    // Expire the key once it would be full again — idle users cost no memory.
    const ttlMs = Math.ceil(policy.capacity / refillPerMs) + 1_000;
    const args = [String(policy.capacity), String(refillPerMs), String(cost), String(ttlMs)];
    const fullKey = this.#prefix + key;

    let reply: unknown;
    try {
      // EVALSHA sends 40 bytes instead of the whole script on every call.
      reply = await this.#redis.evalsha(TOKEN_BUCKET_SHA, 1, fullKey, ...args);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("NOSCRIPT")) throw err;
      reply = await this.#redis.eval(TOKEN_BUCKET_LUA, 1, fullKey, ...args);
    }

    const [allowed, tokens, retryAfterMs] = luaReplySchema.parse(reply);
    return {
      allowed: allowed === 1,
      remaining: Math.floor(Number(tokens)),
      retryAfterMs,
      limit: policy.capacity,
    };
  }
}

/* ───────────────────────────── Factory ───────────────────────────── */

const globalForLimiter = globalThis as unknown as { __matrixRateLimiter?: RateLimiter };

/** Redis when REDIS_URL is set (limits shared by every instance), otherwise in-process. */
export function getRateLimiter(): RateLimiter {
  if (!globalForLimiter.__matrixRateLimiter) {
    const { REDIS_URL } = env();
    globalForLimiter.__matrixRateLimiter = REDIS_URL ? new RedisTokenBucket(REDIS_URL) : new InMemoryTokenBucket();
  }
  return globalForLimiter.__matrixRateLimiter;
}
