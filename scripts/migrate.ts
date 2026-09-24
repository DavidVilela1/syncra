/**
 * Production migration runner — Railway `preDeployCommand` of the web service.
 *
 * Uses drizzle-orm's runtime migrator (a regular dependency) instead of
 * drizzle-kit (a devDependency that may be pruned from the production image).
 * Runs inside Railway's private network, so DATABASE_URL can be the internal URL.
 *
 * A Postgres advisory lock makes it safe even if two deploys race (e.g. a
 * redeploy triggered while the previous pre-deploy is still running): the
 * second runner waits, then finds nothing left to apply.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATION_LOCK_ID = 7_243_117; // arbitrary, app-specific constant

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

// Resolve ./drizzle relative to the project root whether run via tsx (scripts/) or bundled (dist/).
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const started = Date.now();
  await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
  await migrate(drizzle(sql), { migrationsFolder });
  await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
  console.log(`[migrate] database is up to date (${Date.now() - started}ms)`);
  await sql.end();
} catch (err) {
  console.error("[migrate] failed — the deployment will not proceed", err);
  await sql.end({ timeout: 1 });
  process.exit(1);
}
