/** "SYN" + 102 → "SYN-102" */
export function formatTaskKey(workspaceKey: string, number: number): string {
  return `${workspaceKey}-${number}`;
}

const UNITS: ReadonlyArray<readonly [limitSeconds: number, divisor: number, suffix: string]> = [
  [60, 1, "s"],
  [3_600, 60, "m"],
  [86_400, 3_600, "h"],
  [604_800, 86_400, "d"],
  [2_629_800, 604_800, "w"],
  [31_557_600, 2_629_800, "mo"],
  [Number.POSITIVE_INFINITY, 31_557_600, "y"],
];

/** Compact Linear-style relative time: "now", "4m", "3h", "2d". */
export function formatRelativeShort(date: Date, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return "now";
  for (const [limit, divisor, suffix] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${suffix}`;
  }
  return "";
}

/** "Alice Moreau" → "AM" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Deterministic hue per user id, so the same person always has the same avatar colour. */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
