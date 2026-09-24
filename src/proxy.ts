import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "~/server/auth/session";
import { isRoomId } from "~/server/demo/room-id";

/**
 * Route guard for the authenticated app (Next.js 16 "proxy", formerly middleware).
 *
 * Deliberately stateless — it only verifies the signed cookie (no database),
 * so it adds microseconds, not a round-trip, to every navigation:
 *
 *   /dashboard?room=X  + cookie for room X   → render
 *   /dashboard?room=X  + no/other cookie     → /api/auth/demo?room=X (claims the next free persona)
 *   /dashboard         + demo cookie         → /dashboard?room=<its room>
 *   /dashboard, /boards/* + no valid cookie  → landing page
 *
 * Authorization of the DATA still happens in tRPC; this only keeps humans on
 * the right page.
 */
export async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (pathname === "/dashboard") {
    const room = searchParams.get("room");
    if (room !== null) {
      if (!isRoomId(room)) return redirectTo(req, "/", { error: "invalid_room" });
      if (session?.roomId === room) return NextResponse.next();
      return redirectTo(req, "/api/auth/demo", { room });
    }
    if (session?.roomId) return redirectTo(req, "/dashboard", { room: session.roomId });
    return redirectTo(req, "/", session ? {} : { error: "signed_out" });
  }

  // /boards/*
  if (!session) return redirectTo(req, "/", { error: "signed_out" });
  return NextResponse.next();
}

function redirectTo(req: NextRequest, pathname: string, params: Record<string, string>): NextResponse {
  const url = new URL(pathname, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, 307);
  res.headers.set("cache-control", "no-store");
  return res;
}

export const config = {
  matcher: ["/dashboard", "/boards/:path*"],
};
