/**
 * Postgres SQLSTATE lookup that survives driver/ORM error wrapping
 * (Drizzle wraps driver errors in `DrizzleQueryError` with the original as `cause`).
 */
export function pgErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if ("code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current.code;
    }
    current = current.cause;
  }
  return null;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_SERIALIZATION_FAILURE = "40001";
export const PG_DEADLOCK_DETECTED = "40P01";
