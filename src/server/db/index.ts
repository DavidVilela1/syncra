import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** The transaction handle type, so helpers can accept either `db` or `tx`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Cache the pool on globalThis in dev: Next.js HMR re-evaluates modules and
 * would otherwise leak a new connection pool on every save.
 */
const globalForDb = globalThis as unknown as { __matrixSql?: postgres.Sql };

function createClient(): postgres.Sql {
  const { DATABASE_URL, DATABASE_PREPARE } = env();
  return postgres(DATABASE_URL, {
    // Supabase/Neon transaction poolers (PgBouncer) don't support prepared statements.
    prepare: DATABASE_PREPARE,
    max: 10,
  });
}

const client = globalForDb.__matrixSql ?? createClient();
if (env().NODE_ENV !== "production") globalForDb.__matrixSql = client;

export const db: Database = drizzle(client, { schema });
export { schema };
