import type { IncomingMessage } from "node:http";
import { and, eq, gt, sql } from "drizzle-orm";
import { getSessionFromCookieHeader, verifyWsTicket, type Session } from "~/server/auth/session";
import type { Database } from "~/server/db";
import { demoRooms, users } from "~/server/db/schema";
import { RATE_LIMIT_POLICIES, type RateLimiter } from "~/server/rate-limit/token-bucket";

export type UpgradeDecision =
  | { ok: true; session: Session; userId: string }
  | { ok: false; status: 401 | 403 | 429 | 503; reason: string };

export interface UpgradeGuardDeps {
  db: Database;
  limiter: RateLimiter;
  allowedOrigins: ReadonlySet<string>;
  trustProxy: boolean;
}

/**
 * Runs BEFORE the HTTP → WebSocket protocol switch. A rejected client never
 * gets a socket, never allocates tRPC connection state, and never reaches a
 * procedure — it gets a plain HTTP error and a closed TCP connection.
 *
 * Checks are ordered cheapest-first so abusive traffic costs as little as possible:
 *   1. Origin allow-list  (string compare)       → 403
 *   2. Per-IP handshake rate limit (memory/Redis) → 429
 *   3. Credential: WS ticket (?ticket=) or session cookie — HMAC, no I/O → 401
 *   4. User still exists (one indexed DB lookup)  → 401
 *   5. Demo sessions: their room still exists and hasn't expired → 401
 * Per-user connection caps are enforced by the caller, synchronously, right
 * before the upgrade (see server/ws.ts) so concurrent handshakes can't race past it.
 */
export async function authorizeUpgrade(req: IncomingMessage, deps: UpgradeGuardDeps): Promise<UpgradeDecision> {
  // 1. Cross-Site WebSocket Hijacking defence. Browsers attach cookies to the
  //    handshake but, unlike fetch, WebSockets are exempt from CORS — so the
  //    server must check Origin itself. Non-browser clients that omit Origin
  //    are rejected too: this endpoint only serves our web app.
  const origin = req.headers.origin?.replace(/\/$/, "");
  if (!origin || !deps.allowedOrigins.has(origin)) {
    return { ok: false, status: 403, reason: "Origin not allowed" };
  }

  // 2. Reconnect storms / scanners: bucket per client IP.
  const ip = clientIp(req, deps.trustProxy);
  const limit = await deps.limiter
    .consume(`ws.connect:${ip}`, RATE_LIMIT_POLICIES["ws.connect"])
    .catch((err: unknown) => {
      console.error("[ws-guard] limiter unavailable — failing open", err);
      return null;
    });
  if (limit && !limit.allowed) {
    return { ok: false, status: 429, reason: `Too many connection attempts; retry in ${limit.retryAfterMs}ms` };
  }

  // 3. Cross-site deployments (separate WS host) authenticate with a 60s ticket
  //    minted by the app; same-site setups (local dev, shared parent domain)
  //    can still use the session cookie directly. A present-but-invalid ticket
  //    is a hard failure — we never fall back to the cookie in that case.
  const ticket = new URL(req.url ?? "/", "http://ws.invalid").searchParams.get("ticket");
  const session = ticket ? await verifyWsTicket(ticket) : await getSessionFromCookieHeader(req.headers.cookie);
  if (!session) return { ok: false, status: 401, reason: "Missing or invalid credentials" };
  if (session.expiresAt <= Date.now()) return { ok: false, status: 401, reason: "Session expired" };

  // 4. A validly-signed token for a deleted account must not open a socket.
  const [user] = await deps.db.select({ id: users.id }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return { ok: false, status: 401, reason: "Unknown user" };

  // 5. A room-locked (demo) session is only as alive as its room. After the
  //    purge job deletes an expired room its users are gone too (step 4), but
  //    between expiry and purge this check closes the gap.
  if (session.workspaceId) {
    const [room] = await deps.db
      .select({ id: demoRooms.id })
      .from(demoRooms)
      .where(and(eq(demoRooms.workspaceId, session.workspaceId), gt(demoRooms.expiresAt, sql`now()`)))
      .limit(1);
    if (!room) return { ok: false, status: 401, reason: "Demo room has expired" };
  }

  return { ok: true, session, userId: user.id };
}

/**
 * With TRUST_PROXY, use the LAST X-Forwarded-For hop: it's the one appended by
 * the proxy directly in front of us (Railway's edge). Earlier entries are
 * whatever the client sent and are trivially spoofable — keying a rate limit
 * on them would let an attacker rotate fake IPs forever.
 */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers["x-forwarded-for"];
    const hops = (Array.isArray(header) ? header.join(",") : (header ?? "")).split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}
