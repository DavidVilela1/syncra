import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { InMemoryTokenBucket, RedisTokenBucket, type RateLimitPolicy } from "./token-bucket";

const policy: RateLimitPolicy = { capacity: 3, refillPerSecond: 1 };

function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("InMemoryTokenBucket", () => {
  it("allows a burst up to capacity, then rejects with an accurate retry hint", async () => {
    const clock = fakeClock();
    const bucket = new InMemoryTokenBucket({ now: clock.now, sweepIntervalMs: 0 });
    for (let i = 0; i < 3; i++) expect((await bucket.consume("u1", policy)).allowed).toBe(true);
    const denied = await bucket.consume("u1", policy);
    expect(denied).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
    expect(denied.retryAfterMs).toBe(1000);
  });

  it("refills continuously at the sustained rate and never above capacity", async () => {
    const clock = fakeClock();
    const bucket = new InMemoryTokenBucket({ now: clock.now, sweepIntervalMs: 0 });
    for (let i = 0; i < 3; i++) await bucket.consume("u1", policy);
    clock.advance(1500);
    expect((await bucket.consume("u1", policy)).allowed).toBe(true); // 1.5 tokens → 0.5
    expect((await bucket.consume("u1", policy)).allowed).toBe(false);
    clock.advance(60_000);
    const full = await bucket.consume("u1", policy);
    expect(full.remaining).toBe(2); // capped at 3, minus this request
  });

  it("isolates keys", async () => {
    const bucket = new InMemoryTokenBucket({ sweepIntervalMs: 0 });
    for (let i = 0; i < 3; i++) await bucket.consume("a", policy);
    expect((await bucket.consume("a", policy)).allowed).toBe(false);
    expect((await bucket.consume("b", policy)).allowed).toBe(true);
  });

  it("bounds memory by evicting the least-recently-used key", async () => {
    const bucket = new InMemoryTokenBucket({ maxKeys: 2, sweepIntervalMs: 0 });
    for (let i = 0; i < 3; i++) await bucket.consume("old", policy);
    await bucket.consume("mid", policy);
    await bucket.consume("new", policy); // evicts "old"
    expect((await bucket.consume("old", policy)).allowed).toBe(true); // fresh bucket again
  });
});

/** Runs only when a real Redis is provided: TEST_REDIS_URL=redis://localhost:6379 npm test */
const redisUrl = process.env.TEST_REDIS_URL;
describe.skipIf(!redisUrl)("RedisTokenBucket (integration)", () => {
  const redis = new Redis(redisUrl ?? "", { lazyConnect: true });
  const prefix = `test:${Date.now()}:`;
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("enforces capacity atomically under concurrent requests", async () => {
    const bucket = new RedisTokenBucket(redis, prefix);
    const results = await Promise.all(Array.from({ length: 20 }, () => bucket.consume("burst", policy)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const denied = results.find((r) => !r.allowed);
    expect(denied?.retryAfterMs).toBeGreaterThan(0);
    expect(denied?.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("recovers the script after SCRIPT FLUSH (NOSCRIPT fallback)", async () => {
    const bucket = new RedisTokenBucket(redis, prefix);
    await redis.script("FLUSH");
    expect((await bucket.consume("flushed", policy)).allowed).toBe(true);
  });

  it("sets a TTL so idle buckets don't accumulate", async () => {
    const bucket = new RedisTokenBucket(redis, prefix);
    await bucket.consume("ttl", policy);
    const ttl = await redis.pttl(`${prefix}ttl`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(4_000);
  });
});
