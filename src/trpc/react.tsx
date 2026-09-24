"use client";

import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  loggerLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState, type ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "~/server/api/root";
import { getHttpUrl, getWsUrl } from "./shared";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/*
 * TanStack Query batches observer notifications with `setTimeout(0)` by default.
 * Drag-and-drop libraries expect the list to be reordered in the SAME frame the
 * card is dropped; a macrotask delay renders one frame of the old order (the
 * card "snaps back" then jumps). Flushing on a microtask keeps the optimistic
 * cache write visible before the next paint while still batching.
 */
if (typeof window !== "undefined") {
  notifyManager.setScheduler(queueMicrotask);
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime keeps data fresh; avoid redundant refetches on every mount.
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient(): QueryClient {
  // Server: always a fresh client (no cross-request cache leaks).
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() => {
    // Plain HTTP client used only to mint WS tickets (cookie-authenticated).
    const ticketClient = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: getHttpUrl(), transformer: superjson })],
    });
    return createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" || (op.direction === "down" && op.result instanceof Error),
        }),
        splitLink({
          // Subscriptions → single multiplexed WebSocket; everything else → batched HTTP.
          condition: (op) => op.type === "subscription",
          true: wsLink({
            client: createWSClient({
              // Evaluated on EVERY (re)connect → always a fresh 60s ticket.
              url: async () => {
                const { ticket } = await ticketClient.auth.wsTicket.mutate();
                return `${getWsUrl()}?ticket=${encodeURIComponent(ticket)}`;
              },
              // Only open the socket while at least one subscription is active.
              lazy: { enabled: true, closeMs: 10_000 },
              // Client-side half of the heartbeat: detects a dead SERVER (or a
              // silently dropped route) within ~8s and reconnects. These pings
              // also keep the server's own ghost detector from firing on us.
              keepAlive: { enabled: true, intervalMs: 5_000, pongTimeoutMs: 3_000 },
            }),
            transformer: superjson,
          }),
          false: httpBatchLink({ url: getHttpUrl(), transformer: superjson }),
        }),
      ],
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
