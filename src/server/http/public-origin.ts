import type { NextRequest } from "next/server";
import { env } from "~/env";

/**
 * The origin the BROWSER sees (e.g. https://web-production-xxxx.up.railway.app).
 *
 * Behind a TLS-terminating proxy, Next.js builds `req.nextUrl.origin` from its
 * own listening address (`http://0.0.0.0:8080`): wrong scheme, wrong host.
 * Using it for redirects sends users to an unreachable URL, and comparing it
 * with the browser's `Origin` header rejects every legitimate POST.
 *
 * Resolution order:
 *  1. APP_URL: explicit and unspoofable. Set it in production.
 *  2. X-Forwarded-Proto / X-Forwarded-Host, only when TRUST_PROXY=true.
 *  3. The Host header plus the request scheme (local dev).
 */
export function publicOrigin(req: NextRequest): string {
  const { APP_URL, TRUST_PROXY } = env();
  if (APP_URL) return APP_URL;

  const host = (TRUST_PROXY ? firstValue(req.headers.get("x-forwarded-host")) : null) ?? req.headers.get("host");
  if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    const forwardedProto = TRUST_PROXY ? firstValue(req.headers.get("x-forwarded-proto")) : null;
    const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.nextUrl.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

/** Origins allowed to POST state-changing forms (CSRF check). */
export function isAllowedOrigin(req: NextRequest, origin: string | null): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  return normalized === publicOrigin(req) || env().ALLOWED_ORIGINS.includes(normalized);
}

/** Absolute URL on the public origin — use for every redirect. */
export function publicUrl(req: NextRequest, pathname: string): URL {
  return new URL(pathname, publicOrigin(req));
}

function firstValue(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim();
  return first ? first : null;
}
