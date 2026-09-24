/**
 * The fixed cast every demo room is staffed with. Seat order = join order:
 * the room creator becomes Alice, the next visitor Bruno, and so on.
 * Avatars are hand-made SVGs in /public/avatars (no third-party image hosts).
 */
export interface Persona {
  slot: number;
  handle: string;
  name: string;
  title: string;
  avatarUrl: string;
}

export const PERSONAS: readonly Persona[] = [
  { slot: 0, handle: "alice", name: "Alice Moreau", title: "Staff Engineer", avatarUrl: "/avatars/alice.svg" },
  { slot: 1, handle: "bruno", name: "Bruno Costa", title: "Product Designer", avatarUrl: "/avatars/bruno.svg" },
  { slot: 2, handle: "chen", name: "Chen Wei", title: "Platform Lead", avatarUrl: "/avatars/chen.svg" },
  { slot: 3, handle: "dana", name: "Dana Okafor", title: "Frontend Engineer", avatarUrl: "/avatars/dana.svg" },
  { slot: 4, handle: "eli", name: "Eli Novak", title: "SRE", avatarUrl: "/avatars/eli.svg" },
  { slot: 5, handle: "farah", name: "Farah Haddad", title: "Engineering Manager", avatarUrl: "/avatars/farah.svg" },
];

export const ROOM_CAPACITY = PERSONAS.length;
