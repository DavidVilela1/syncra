/**
 * Standalone tRPC WebSocket server.
 *
 * Next.js route handlers can't hold long-lived WebSocket connections (and are
 * often serverless), so subscriptions run in a small dedicated Node process
 * sharing the SAME appRouter, context and auth as the HTTP API.
 *
 * Lifecycle of a connection:
 *   HTTP Upgrade request
 *     → authorizeUpgrade(): origin, per-IP rate limit, session, user   (reject = HTTP 4xx, no socket)
 *     → per-user connection cap                                        (reject = HTTP 429)
 *     → protocol switch → tRPC handler (session pre-verified, no re-parse)
 *     → keep-alive: a silent client is terminated after ≤10s → subscriptions torn down → presence left
 *     → hard close (4401) the moment the session token expires
 */
import "dotenv/config";
import { STATUS_CODES, createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import type { Session } from "~/server/auth/session";
import { db } from "~/server/db";
import { checkHealth } from "~/server/health";
import { startMaintenance } from "~/server/maintenance";
import { getRateLimiter } from "~/server/rate-limit/token-bucket";
import { authorizeUpgrade } from "~/server/realtime/ws-guard";

const config = env();

/**
 * Keep-alive tuning. tRPC sends an app-level "PING" after PING_MS of silence
 * and terminates the socket if nothing arrives within PONG_WAIT_MS, so a ghost
 * connection is dropped at most PING_MS + PONG_WAIT_MS = 10s after its last
 * message. Healthy clients also ping every 5s (see src/trpc/react.tsx), which
 * counts as activity — so live sockets are never falsely terminated.
 */
const PING_MS = 5_000;
const PONG_WAIT_MS = 5_000;
/** Closes sockets whose session expired. Custom 4xxx code so the client can tell why. */
const CLOSE_SESSION_EXPIRED = 4401;
/** setTimeout overflows above 2^31-1 ms (~24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Railway injects PORT and health-checks + routes its public domain to it;
 * WS_PORT is the local-dev fallback.
 */
const PORT = config.PORT ?? config.WS_PORT;

const allowedOrigins = new Set(config.ALLOWED_ORIGINS);
/** Flipped on SIGTERM: the healthcheck starts failing so no new traffic is routed here. */
let draining = false;
const limiter = getRateLimiter();

/** Sessions verified at handshake time, handed to createContext without re-parsing. */
const verifiedSessions = new WeakMap<IncomingMessage, Session>();
const connectionsPerUser = new Map<string, number>();

const httpServer = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  /*
   * Deploy healthcheck. Railway calls it from `healthcheck.railway.app` (no
   * Origin, no cookie) — it's plain HTTP, so none of the upgrade guards apply.
   * Deep check: 200 only when Postgres (and Redis, if configured) answer, so a
   * mis-wired deploy never replaces a healthy one. `/healthz` kept as an alias.
   */
  if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
    if (draining) {
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
        res.end(JSON.stringify({ ...report, connections: wss.clients.size }));
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

const wss = new WebSocketServer({
  noServer: true, // we own the upgrade → nothing reaches `ws` unauthenticated
  maxPayload: 64 * 1024, // tRPC messages are tiny; refuse memory-bloat frames
  perMessageDeflate: false, // avoids zlib CPU/memory amplification attacks
});

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  const body = `${reason}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  // A client can vanish mid-handshake; without this, the error would crash the process.
  socket.on("error", () => socket.destroy());
  if (draining) {
    rejectUpgrade(socket, 503, "Server is restarting — reconnect shortly");
    return;
  }

  authorizeUpgrade(req, { db, limiter, allowedOrigins, trustProxy: config.TRUST_PROXY })
    .then((decision) => {
      if (!decision.ok) {
        rejectUpgrade(socket, decision.status, decision.reason);
        return;
      }
      if (socket.destroyed) return; // client gave up while we were checking

      // Checked and reserved synchronously → concurrent handshakes can't race past the cap.
      const open = connectionsPerUser.get(decision.userId) ?? 0;
      if (open >= config.WS_MAX_CONNECTIONS_PER_USER) {
        rejectUpgrade(socket, 429, "Too many open connections for this account");
        return;
      }
      connectionsPerUser.set(decision.userId, open + 1);

      wss.handleUpgrade(req, socket, head, (ws) => {
        verifiedSessions.set(req, decision.session);

        const expiryTimer = setTimeout(
          () => ws.close(CLOSE_SESSION_EXPIRED, "Session expired"),
          Math.min(Math.max(0, decision.session.expiresAt - Date.now()), MAX_TIMER_MS),
        );

        ws.once("close", () => {
          clearTimeout(expiryTimer);
          const remaining = (connectionsPerUser.get(decision.userId) ?? 1) - 1;
          if (remaining <= 0) connectionsPerUser.delete(decision.userId);
          else connectionsPerUser.set(decision.userId, remaining);
        });

        wss.emit("connection", ws, req);
      });
    })
    .catch((err: unknown) => {
      console.error("[ws] upgrade check failed", err);
      rejectUpgrade(socket, 503, "Service unavailable");
    });
});

const handler = applyWSSHandler({
  wss,
  router: appRouter,
  // Only authenticated upgrades reach here, so the session is always present;
  // `isAuthed` still re-checks expiry and user existence on every procedure call.
  createContext: ({ req }) => createTRPCContext({ session: verifiedSessions.get(req) ?? null }),
  keepAlive: { enabled: true, pingMs: PING_MS, pongWaitMs: PONG_WAIT_MS },
});

/**
 * Bind dual-stack ("::" accepts IPv6 AND IPv4) — needed for Railway's IPv6
 * private network. Hosts with IPv6 disabled (some Docker/WSL/CI setups) throw
 * EAFNOSUPPORT for "::", so fall back to IPv4-only there instead of crashing.
 */
function listen(host: string, fallback: string | null): void {
  const onListening = () => {
    httpServer.off("error", onError);
    console.log(`[ws] tRPC WebSocket server listening on ${host}:${PORT} (health: /health)`);
    console.log(`[ws] allowed origins: ${[...allowedOrigins].join(", ")}`);
  };
  const onError = (err: NodeJS.ErrnoException) => {
    httpServer.off("listening", onListening); // this attempt failed — don't log it later
    if (fallback && (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL")) {
      console.warn(`[ws] cannot bind ${host} (${err.code}) — falling back to ${fallback}`);
      listen(fallback, null);
      return;
    }
    throw err;
  };
  httpServer.once("error", onError);
  httpServer.once("listening", onListening);
  httpServer.listen(PORT, host);
}
listen("::", "0.0.0.0");

// Expired demo rooms + stale presence rows. Advisory-locked → safe on every replica.
const stopMaintenance = startMaintenance(db);

/**
 * Zero-downtime redeploys on Railway: the new deployment passes /health, then
 * the old one gets SIGTERM. We stop accepting upgrades, tell every client to
 * reconnect (they land on the new deployment), and exit well inside
 * `drainingSeconds` (railway/ws.json) before Railway sends SIGKILL.
 */
function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  stopMaintenance();
  console.log(`[ws] ${signal} received — draining ${wss.clients.size} connection(s)`);
  // Tells clients to reconnect (to another instance) instead of erroring.
  handler.broadcastReconnectNotification();
  wss.close();
  httpServer.close(() => process.exit(0));
  // Don't hang forever on stubborn sockets.
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
