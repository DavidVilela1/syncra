/**
 * Stable id for THIS browser tab (not user — a user may have two tabs open,
 * and the second tab must still receive the first tab's moves).
 */
let clientId: string | undefined;

export function getClientId(): string {
  clientId ??= crypto.randomUUID();
  return clientId;
}
