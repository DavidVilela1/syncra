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

export function getWsUrl(): string {
  return process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
}
