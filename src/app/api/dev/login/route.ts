import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "~/server/auth/session";

/**
 * Passwordless sign-in for SEEDED demo users (there is no real auth provider yet).
 *
 * • development: always on.
 * • production: 404 unless DEMO_LOGIN_ENABLED=true — an explicit opt-in for a
 *   public portfolio demo. Anyone holding a seeded user's id can sign in as
 *   them, so only enable it for a demo workspace with nothing private in it.
 */
const query = z.object({
  userId: z.uuid(),
  next: z.string().regex(/^\/(?!\/)/, "must be a relative path").default("/"),
});

export async function GET(req: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && process.env.DEMO_LOGIN_ENABLED !== "true") {
    return new NextResponse(null, { status: 404 });
  }

  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json(z.flattenError(parsed.error), { status: 400 });

  const res = NextResponse.redirect(new URL(parsed.data.next, req.nextUrl.origin));
  const ttlSeconds = 60 * 60 * 24 * 7;
  res.cookies.set(
    SESSION_COOKIE,
    await signSession({ userId: parsed.data.userId, ttlSeconds }),
    sessionCookieOptions(ttlSeconds),
  );
  return res;
}
