import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "~/server/auth/session";
import { publicUrl } from "~/server/http/public-origin";

/** POST-only so a stray <img src> or prefetch can't sign the user out. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(publicUrl(req, "/"), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}
