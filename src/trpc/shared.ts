import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "~/server/api/root";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type BoardData = RouterOutputs["board"]["byId"];
export type BoardColumn = BoardData["columns"][number];
export type BoardTask = BoardColumn["tasks"][number];
export type MoveTaskVariables = RouterInputs["task"]["moveTask"];

export function getHttpUrl(): string {
  if (typeof window !== "undefined") return "/api/trpc";
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT ?? 3000}`;
  return `${origin}/api/trpc`;
}

/**
 * WebSocket endpoint. When NEXT_PUBLIC_WS_URL is unset (single-service
 * deployment, server/app.ts), the socket lives on the SAME origin as the page,
 * so derive it from the address bar: https → wss, http → ws. Local dev sets
 * NEXT_PUBLIC_WS_URL=ws://localhost:3001 because `npm run dev` runs two processes.
 */
export function getWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured && configured.trim() !== "") return configured;
  if (typeof window !== "undefined") {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${window.location.host}`;
  }
  return "ws://localhost:3001";
}
