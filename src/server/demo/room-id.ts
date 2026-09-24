import { randomInt } from "node:crypto";

/**
 * Room ids are the invite token, so they must be unguessable AND easy to read
 * aloud / type from a screenshot: 10 chars from a 31-symbol alphabet with no
 * look-alikes (0/o, 1/l/i) → 31^10 ≈ 8×10^14 (~49.6 bits) of CSPRNG entropy.
 * `randomInt` is uniform (rejection-sampled), so there's no modulo bias.
 */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const ROOM_ID_LENGTH = 10;
const ROOM_ID_PATTERN = new RegExp(`^[${ALPHABET}]{${ROOM_ID_LENGTH}}$`);

export function generateRoomId(): string {
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ALPHABET.charAt(randomInt(ALPHABET.length));
  return id;
}

export function isRoomId(value: string | null | undefined): value is string {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}
