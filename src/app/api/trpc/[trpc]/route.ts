import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { RateLimitError } from "~/server/rate-limit/token-bucket";

/** Queries & mutations over HTTP (batched). Subscriptions go over WS — see server/ws.ts. */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ cookieHeader: req.headers.get("cookie") }),
    /**
     * tRPC already maps TOO_MANY_REQUESTS → HTTP 429. We add the standard
     * `Retry-After` header so proxies, CDNs and generic HTTP clients back off too.
     */
    responseMeta({ errors }) {
      const retryAfterMs = errors.reduce(
        (max, e) => (e.cause instanceof RateLimitError ? Math.max(max, e.cause.result.retryAfterMs) : max),
        0,
      );
      return retryAfterMs > 0 ? { headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } } : {};
    },
    onError({ path, error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[tRPC] ${path ?? "<no-path>"} failed:`, error);
      }
    },
  });

export { handler as GET, handler as POST };
