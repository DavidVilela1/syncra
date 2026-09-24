import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  getSessionFromCookieHeader,
  sessionCookieOptions,
  signSession,
} from "~/server/auth/session";
import { db } from "~/server/db";
import { createDemoRoom, joinDemoRoom, type SeatAssignment } from "~/server/demo/rooms";
import { isRoomId } from "~/server/demo/room-id";
import { clientIpFromHeaders } from "~/server/http/client-ip";
import { RATE_LIMIT_POLICIES, getRateLimiter } from "~/server/rate-limit/token-bucket";
import { getPresenceStore } from "~/server/realtime/presence-store";

/**
 * Demo-room authentication engine.
 *
 *   POST /api/auth/demo            → create a room, seat the caller as Alice
 *   GET  /api/auth/demo?room=<id>  → join a room as the next free persona
 *
 * Both end by baking a signed, HttpOnly session — locked to the room's
 * workspace — into a cookie and redirecting to /dashboard?room=<id>.
 * Failures redirect back to the landing page with a readable `?error=` code
 * instead of dumping JSON on a human.
 */

function landing(req: NextRequest, error: string, extra: Record<string, string> = {}): NextResponse {
  const url = new URL("/", req.nextUrl.origin);
  url.searchParams.set("error", error);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

async function enterRoom(req: NextRequest, seat: SeatAssignment, welcome: boolean): Promise<NextResponse> {
  const url = new URL("/dashboard", req.nextUrl.origin);
  url.searchParams.set("room", seat.roomId);
  if (welcome) url.searchParams.set("as", seat.persona.handle);

  // 303 → the browser follows with a GET, so a refresh never re-POSTs (no duplicate rooms).
  const res = NextResponse.redirect(url, { status: 303 });
  const token = await signSession({
    userId: seat.userId,
    workspaceId: seat.workspaceId,
    roomId: seat.roomId,
    ttlSeconds: DEMO_SESSION_TTL_SECONDS,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(DEMO_SESSION_TTL_SECONDS));
  // A redirect that sets an identity cookie must never be cached by a CDN.
  res.headers.set("cache-control", "no-store");
  return res;
}

async function allow(req: NextRequest, policy: "demo.create" | "demo.join"): Promise<boolean> {
  try {
    const result = await getRateLimiter().consume(
      `${policy}:${clientIpFromHeaders(req.headers)}`,
      RATE_LIMIT_POLICIES[policy],
    );
    return result.allowed;
  } catch (err) {
    console.error(`[demo] ${policy} limiter unavailable — failing open`, err);
    return true;
  }
}

/** Create a room. Triggered by the landing page's <form method="post">. */
export async function POST(req: NextRequest) {
  // CSRF: only our own pages may create rooms and swap the visitor's session.
  const origin = req.headers.get("origin");
  if (origin !== req.nextUrl.origin) {
    return new NextResponse("Cross-origin request rejected", { status: 403 });
  }
  if (!(await allow(req, "demo.create"))) return landing(req, "rate_limited");

  try {
    const seat = await createDemoRoom(db);
    return enterRoom(req, seat, true);
  } catch (err) {
    console.error("[demo] room creation failed", err);
    return landing(req, "create_failed");
  }
}

/** Join a room. Reached via the proxy when someone opens a shared invite link. */
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("room");
  if (!isRoomId(roomId)) return landing(req, "invalid_room");
  if (!(await allow(req, "demo.join"))) return landing(req, "rate_limited");

  const current = await getSessionFromCookieHeader(req.headers.get("cookie"));
  const result = await joinDemoRoom(db, getPresenceStore(db), roomId, current);

  switch (result.kind) {
    case "joined":
      return enterRoom(req, result, !result.reused);
    case "full":
      return landing(req, "room_full", { room: roomId });
    case "not_found":
      return landing(req, "room_expired");
  }
}
