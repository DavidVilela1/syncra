import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "~/env";

/**
 * Stateless session: an HS256 JWT in an HttpOnly cookie.
 *
 * Auth-provider agnostic on purpose — Auth.js, Clerk or Lucia can mint this same
 * cookie. The SAME verification runs for HTTP requests, the Next.js proxy and
 * the WebSocket handshake, so every entry point shares one authorization model.
 */
export const SESSION_COOKIE = "matrix_session";
const ISSUER = "matrix";
const AUDIENCE = "matrix:web";

/** Demo-room sessions live as long as a room is likely to be in use. */
export const DEMO_SESSION_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const claimsSchema = z.object({
  sub: z.uuid(),
  exp: z.number().int().positive(),
  /** Workspace the session is LOCKED to (demo rooms). Absent for regular accounts. */
  wid: z.uuid().optional(),
  /** Public demo room id — lets the proxy route without a database lookup. */
  rid: z.string().min(1).max(16).optional(),
});

export interface Session {
  userId: string;
  /** Epoch ms at which the token stops being valid. Long-lived WS contexts re-check this. */
  expiresAt: number;
  /**
   * When set, this session may only touch this workspace — enforced by the
   * tRPC access middleware on every procedure (defence in depth on top of
   * membership, which already confines demo personas to their room).
   */
  workspaceId: string | null;
  /** Demo room this session belongs to (null for regular accounts). */
  roomId: string | null;
}

export interface SignSessionInput {
  userId: string;
  workspaceId?: string | null;
  roomId?: string | null;
  ttlSeconds?: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function signSession({
  userId,
  workspaceId = null,
  roomId = null,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
}: SignSessionInput): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: { wid?: string; rid?: string } = {};
  if (workspaceId) claims.wid = workspaceId;
  if (roomId) claims.rid = roomId;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return {
      userId: claims.data.sub,
      expiresAt: claims.data.exp * 1000,
      workspaceId: claims.data.wid ?? null,
      roomId: claims.data.rid ?? null,
    };
  } catch {
    return null;
  }
}

/** Cookie attributes shared by every route that sets or clears the session. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // HTTPS-only in production (Railway terminates TLS at its edge).
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * WebSocket ticket — why it exists:
 * In production the app and the WS server live on DIFFERENT hosts (on Railway:
 * `web-…up.railway.app` and `ws-…up.railway.app`). `up.railway.app` is on the
 * Public Suffix List, so those are different *sites*: the HttpOnly session
 * cookie is never sent to the WS host. Instead the browser asks the app (with
 * its cookie) for a ticket and passes it in the WS URL.
 *
 * Tickets are useless for anything else: separate audience, 60s lifetime, and
 * they carry the parent session's expiry AND workspace lock, so the socket can
 * neither outlive the login nor escape its room.
 */
const WS_AUDIENCE = "matrix:ws";
const WS_TICKET_TTL_SECONDS = 60;
const ticketClaimsSchema = z.object({
  sub: z.uuid(),
  sx: z.number().int().positive(),
  wid: z.uuid().optional(),
});

export async function signWsTicket(session: Session): Promise<{ ticket: string; expiresAt: number }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = Math.min(nowSeconds + WS_TICKET_TTL_SECONDS, Math.floor(session.expiresAt / 1000));
  const claims: { sx: number; wid?: string } = { sx: Math.floor(session.expiresAt / 1000) };
  if (session.workspaceId) claims.wid = session.workspaceId;
  const ticket = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuer(ISSUER)
    .setAudience(WS_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(exp)
    .sign(secretKey());
  return { ticket, expiresAt: exp * 1000 };
}

/** Returns the PARENT session (its expiry + workspace lock), not the ticket's 60s lifetime. */
export async function verifyWsTicket(ticket: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(ticket, secretKey(), {
      issuer: ISSUER,
      audience: WS_AUDIENCE,
      algorithms: ["HS256"],
    });
    const claims = ticketClaimsSchema.safeParse(payload);
    if (!claims.success) return null;
    // The WS side only needs the workspace lock; the room id is a routing concern of the web app.
    return { userId: claims.data.sub, expiresAt: claims.data.sx * 1000, workspaceId: claims.data.wid ?? null, roomId: null };
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export async function getSessionFromCookieHeader(cookieHeader: string | null | undefined): Promise<Session | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return token ? verifySession(token) : null;
}
