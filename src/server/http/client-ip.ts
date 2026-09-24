import { env } from "~/env";

/**
 * Client IP for rate limiting in Next.js route handlers (no socket access).
 *
 * With TRUST_PROXY=true (Railway, any LB you control) the LAST X-Forwarded-For
 * hop is the one written by the proxy in front of us and can't be forged.
 * Without a trusted proxy the header is attacker-controlled, so every request
 * shares one "untrusted" bucket — strict, but impossible to evade by spoofing.
 */
export function clientIpFromHeaders(headers: Headers): string {
  if (!env().TRUST_PROXY) return "untrusted-proxy";
  const hops = (headers.get("x-forwarded-for") ?? "").split(",");
  return hops[hops.length - 1]?.trim() || "unknown";
}
