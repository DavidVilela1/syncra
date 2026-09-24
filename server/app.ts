/**
 * All-in-one production server: Next.js pages/API AND the tRPC WebSocket
 * endpoint on ONE port and ONE domain.
 *
 * This is the simplest deployment: a single Railway service. The browser
 * opens its socket on the same origin as the page, so there's no second
 * domain, no ALLOWED_ORIGINS to keep in sync and no build-time WS URL to get
 * wrong. (server/ws.ts remains available to split sockets into their own
 * service later — the realtime layer is shared.)
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { env } from "~/env";
import { attachRealtime, listenDualStack } from "~/server/realtime/attach-realtime";

const config = env();
const PORT = config.PORT ?? 3000;

async function main() {
  /*
   * Next.js attaches its OWN `upgrade` listener to the HTTP server on the first
   * request (for dev hot-reload) and closes any socket it doesn't recognise:
   * it would kill our WebSocket handshakes before the auth guard answers.
   * `httpServer` is the only thing Next uses that option for, so we hand it a
   * never-listening decoy server and keep the real one's upgrades to ourselves.
   */
  const decoy = createServer();
  const app = next({ dev: false, dir: process.cwd(), port: PORT, httpServer: decoy });
  await app.prepare();
  const handle = app.getRequestHandler();

  // Regular HTTP → Next.js (pages, /api/trpc, /api/health, proxy.ts).
  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error("[app] request failed", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  // WebSocket upgrades → authenticated tRPC subscriptions.
  const realtime = attachRealtime(httpServer);

  listenDualStack(httpServer, PORT, (host) => {
    console.log(`[app] Next.js + realtime listening on ${host}:${PORT}`);
    console.log(`[app] WebSocket allowed origins: ${[...realtime.allowedOrigins].join(", ") || "(none)"}`);
  });

  const shutdown = (signal: string) => {
    if (realtime.isDraining()) return;
    console.log(`[app] ${signal} received`);
    realtime.drain();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[app] failed to start", err);
  process.exit(1);
});
