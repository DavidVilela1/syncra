import { z } from "zod";

/**
 * Server-only environment, validated once at boot. Importing this from a client
 * component is a bug; Next.js would inline `undefined` for non-public vars.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  DATABASE_PREPARE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  /**
   * Optional direct/session connection for LISTEN/NOTIFY when DATABASE_URL points
   * at a transaction pooler (Supabase :6543, Neon "-pooler" hosts).
   */
  REALTIME_DATABASE_URL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v)),
  /**
   * Public origin of the web app as the browser sees it, e.g.
   * https://web-production-xxxx.up.railway.app (no trailing slash).
   * Used for redirects and the CSRF Origin check; required behind a proxy.
   */
  APP_URL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()))
    .pipe(z.url().transform((u) => new URL(u).origin).optional()),
  WS_PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Injected by Railway (and most PaaS). When present the WS server listens on
   * it — Railway routes the public domain and runs the healthcheck on $PORT.
   */
  PORT: z.coerce.number().int().positive().optional(),
  /**
   * Comma-separated origins allowed to open a WebSocket (defence against
   * cross-site WebSocket hijacking — browsers attach cookies to WS handshakes).
   */
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean),
    ),
  /** Max simultaneous sockets per user (tabs × devices). */
  WS_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().default(10),
  /** Trust X-Forwarded-For for client IPs — only enable behind your own proxy/LB. */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
