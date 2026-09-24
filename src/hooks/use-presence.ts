"use client";

import { useSubscription } from "@trpc/tanstack-react-query";
import { useTRPC } from "~/trpc/react";

/**
 * Live roster of users viewing a board. Holding this subscription open is
 * what makes the current user appear in everyone else's avatar stack.
 */
export function usePresence(boardId: string) {
  const trpc = useTRPC();
  const subscription = useSubscription(trpc.presence.onBoard.subscriptionOptions({ boardId }));
  return { users: subscription.data ?? [], status: subscription.status };
}
