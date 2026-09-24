import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import type { Session } from "~/server/auth/session";
import { db } from "~/server/db";
import { startMaintenance } from "~/server/maintenance";
import { getRateLimiter } from "~/server/rate-limit/token-bucket";
import { authorizeUpgrade } from "./ws-guard";

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

export interface Realtime {
  /** Live socket count (for health output). */
  connections: () => number;
  isDraining: () => boolean;
  /** Stop accepting upgrades and tell every client to reconnect elsewhere. */
  drain: () => void;
  allowedOrigins: ReadonlySet<string>;
}

/**
 * Mounts the authenticated tRPC WebSocket endpoint on ANY Node HTTP server.
 *
 * Used by both deployment shapes:
 *  • server/app.ts: Next.js + WebSockets on one port (single Railway service)
 *  • server/ws.ts:  a dedicated WebSocket service (scale sockets independently)
 *
 * Every upgrade passes the handshake guard (origin, per-IP limit, ticket/cookie,
 * user, room, per-user cap) BEFORE a socket exists.
 */
export function attachRealtime(httpServer: Server): Realtime {
  const config = env();
  // The app's own public origin is always allowed: in single-service mode the
  // page and the socket share it, so no extra configuration is needed.
  const allowedOrigins = new Set([...config.ALLOWED_ORIGINS, ...(config.APP_URL ? [config.APP_URL] : [])]);
  const limiter = getRateLimiter();
  const verifiedSessions = new WeakMap<IncomingMessage, Session>();
  const connectionsPerUser = new Map<string, number>();
  let draining = false;

  const wss = new WebSocketServer({
    noServer: true, // we own the upgrade → nothing reaches `ws` unauthenticated
    maxPayload: 64 * 1024, // tRPC messages are tiny; refuse memory-bloat frames
    perMessageDeflate: false, // avoids zlib CPU/memory amplification attacks
  });

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
        console.error("[realtime] upgrade check failed", err);
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

  // Expired demo rooms + stale presence rows. Advisory-locked → safe on every replica.
  const stopMaintenance = startMaintenance(db);

  return {
    connections: () => wss.clients.size,
    isDraining: () => draining,
    allowedOrigins,
    drain: () => {
      if (draining) return;
      draining = true;
      stopMaintenance();
      console.log(`[realtime] draining ${wss.clients.size} connection(s)`);
      handler.broadcastReconnectNotification();
      wss.close();
    },
  };
}

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

/**
 * Bind dual-stack ("::" accepts IPv6 AND IPv4) — needed for Railway's IPv6
 * private network. Hosts with IPv6 disabled (some Docker/WSL/CI setups) throw
 * EAFNOSUPPORT for "::", so fall back to IPv4-only there instead of crashing.
 */
export function listenDualStack(httpServer: Server, port: number, onListening: (host: string) => void): void {
  const attempt = (host: string, fallback: string | null) => {
    const handleListening = () => {
      httpServer.off("error", handleError);
      onListening(host);
    };
    const handleError = (err: NodeJS.ErrnoException) => {
      httpServer.off("listening", handleListening);
      if (fallback && (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL")) {
        console.warn(`[server] cannot bind ${host} (${err.code}) — falling back to ${fallback}`);
        attempt(fallback, null);
        return;
      }
      throw err;
    };
    httpServer.once("error", handleError);
    httpServer.once("listening", handleListening);
    httpServer.listen(port, host);
  };
  attempt("::", "0.0.0.0");
}
