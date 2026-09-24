import { Redis, type RedisOptions } from "ioredis";

/**
 * Single place that creates Redis connections.
 *
 * `family: 0` lets the DNS lookup return IPv4 OR IPv6. Railway's private
 * network (`redis.railway.internal`) is IPv6-only in environments created
 * before Oct 2025; ioredis defaults to IPv4 (family 4) and would fail with
 * ENOTFOUND there. Harmless everywhere else.
 */
export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    family: 0,
    // Don't queue commands forever while Redis is unreachable — fail fast and let callers degrade.
    maxRetriesPerRequest: 3,
    ...options,
  });
}
