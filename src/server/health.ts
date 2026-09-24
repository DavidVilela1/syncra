import { sql } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/server/db";
import { createRedis } from "~/server/redis";

export interface DependencyCheck {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { postgres: DependencyCheck; redis?: DependencyCheck };
  uptimeSeconds: number;
}

const CHECK_TIMEOUT_MS = 2_000;

async function timed(run: () => Promise<unknown>): Promise<DependencyCheck> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : "unknown error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Dedicated, lazily-created connection so health probes never queue behind app traffic. */
let healthRedis: ReturnType<typeof createRedis> | undefined;

/**
 * Deep readiness check used by BOTH services' deploy healthchecks.
 *
 * Railway only calls the healthcheck while a deployment is rolling out, and
 * switches traffic to it only on a 2xx. Checking real dependencies (not just
 * "the process is up") means a deploy with a wrong DATABASE_URL, a missing
 * private-network hostname or a dead Redis never goes live — the previous
 * healthy deployment keeps serving instead.
 */
export async function checkHealth(): Promise<HealthReport> {
  const { REDIS_URL } = env();
  const postgres = await timed(() => db.execute(sql`select 1`));

  let redis: DependencyCheck | undefined;
  if (REDIS_URL) {
    healthRedis ??= createRedis(REDIS_URL, { maxRetriesPerRequest: 1, connectionName: "matrix:health" });
    const client = healthRedis;
    redis = await timed(() => client.ping());
  }

  const ok = postgres.ok && (redis?.ok ?? true);
  return {
    status: ok ? "ok" : "degraded",
    checks: redis ? { postgres, redis } : { postgres },
    uptimeSeconds: Math.round(process.uptime()),
  };
}
