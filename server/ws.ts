/**
 * Dedicated WebSocket service (optional deployment shape).
 *
 * Run this as its own Railway service when you want to scale sockets
 * independently of page rendering. For a single-service deployment, use
 * server/app.ts instead: it serves Next.js AND WebSockets on one port.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { env } from "~/env";
import { checkHealth } from "~/server/health";
import { attachRealtime, listenDualStack } from "~/server/realtime/attach-realtime";

const config = env();
/** Railway injects PORT (and health-checks it); WS_PORT is the local-dev fallback. */
const PORT = config.PORT ?? config.WS_PORT;

const httpServer = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  // Deploy healthcheck: 200 only when Postgres, the schema (and Redis, if configured) are OK.
  if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
    if (realtime.isDraining()) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ status: "draining" }));
      return;
    }
    checkHealth()
      .then((report) => {
        res.writeHead(report.status === "ok" ? 200 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ ...report, connections: realtime.connections() }));
      })
      .catch((err: unknown) => {
        console.error("[ws] healthcheck failed", err);
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error" }));
      });
    return;
  }

  // Everything else must be a WebSocket upgrade.
  res.writeHead(426, { "content-type": "text/plain", upgrade: "websocket" });
  res.end("Upgrade Required");
});

const realtime = attachRealtime(httpServer);

listenDualStack(httpServer, PORT, (host) => {
  console.log(`[ws] tRPC WebSocket server listening on ${host}:${PORT} (health: /health)`);
  console.log(`[ws] allowed origins: ${[...realtime.allowedOrigins].join(", ")}`);
});

/** Zero-downtime redeploys: stop upgrades, tell clients to reconnect, exit before SIGKILL. */
function shutdown(signal: string) {
  if (realtime.isDraining()) return;
  console.log(`[ws] ${signal} received`);
  realtime.drain();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
