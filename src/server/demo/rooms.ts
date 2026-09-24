import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "~/server/db";
import {
  demoRoomSeats,
  demoRooms,
  tasks,
  users,
  workspaceMembers,
  workspaces,
  type DemoRoom,
} from "~/server/db/schema";
import type { PresenceStore } from "~/server/realtime/presence-store";
import { PERSONAS, ROOM_CAPACITY, type Persona } from "~/lib/personas";
import { generateRoomId } from "./room-id";
import { DEMO_ROOM_BOARD, FIRST_TASK_NUMBER, insertBoardFromTemplate } from "./template";

/** Sliding lifetime: each join pushes expiry out again; idle rooms are purged. */
export const DEMO_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A seat handed out is reserved for this long even before its WebSocket shows
 * up in presence — covers page load + socket handshake, so two people joining
 * at the same instant can't both be given "Bruno".
 */
export const SEAT_LEASE_MS = 90_000;

export interface SeatAssignment {
  roomId: string;
  workspaceId: string;
  boardId: string;
  userId: string;
  persona: Persona;
}

export type JoinResult =
  | ({ kind: "joined"; reused: boolean } & SeatAssignment)
  | { kind: "full"; roomId: string }
  | { kind: "not_found" };

function personaForSlot(slot: number): Persona {
  const persona = PERSONAS[slot];
  if (!persona) throw new Error(`No persona for slot ${slot}`);
  return persona;
}

/** An unexpired room, or null. Expired rows may linger until the purge job runs. */
export async function findActiveRoom(db: Database, roomId: string): Promise<DemoRoom | null> {
  const [room] = await db
    .select()
    .from(demoRooms)
    .where(and(eq(demoRooms.id, roomId), gt(demoRooms.expiresAt, sql`now()`)))
    .limit(1);
  return room ?? null;
}

/**
 * Provisions a complete sandbox in ONE transaction — workspace, board with
 * realistic content, the six persona users, memberships and seats — and seats
 * the creator as persona #0 (Alice). Either everything exists or nothing does.
 */
export async function createDemoRoom(db: Database): Promise<SeatAssignment> {
  return db.transaction(async (tx) => {
    const roomId = generateRoomId();
    const expiresAt = new Date(Date.now() + DEMO_ROOM_TTL_MS);

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: "Syncra Demo", slug: `demo-${roomId}`, key: "SYN" })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace insert failed");

    // Board first (FK target of the room); tasks get their author once personas exist.
    const { boardId, nextNumber } = await insertBoardFromTemplate(tx, {
      workspaceId: workspace.id,
      template: DEMO_ROOM_BOARD,
      firstNumber: FIRST_TASK_NUMBER,
      createdById: null,
    });
    await tx
      .update(workspaces)
      .set({ taskSeq: nextNumber - 1 })
      .where(eq(workspaces.id, workspace.id));

    await tx.insert(demoRooms).values({ id: roomId, workspaceId: workspace.id, boardId, expiresAt });

    const cast = await tx
      .insert(users)
      .values(
        PERSONAS.map((p) => ({
          // Unique per room; the reserved .invalid TLD guarantees these never receive mail.
          email: `${p.handle}+${roomId}@demo.syncra.invalid`,
          name: p.name,
          avatarUrl: p.avatarUrl,
          demoRoomId: roomId,
        })),
      )
      .returning({ id: users.id, email: users.email });
    const bySlot = PERSONAS.map((p) => {
      const user = cast.find((u) => u.email.startsWith(`${p.handle}+`));
      if (!user) throw new Error(`persona ${p.handle} missing`);
      return { persona: p, userId: user.id };
    });
    const host = bySlot[0];
    if (!host) throw new Error("no host persona");

    await tx.insert(workspaceMembers).values(
      bySlot.map(({ persona, userId }) => ({
        workspaceId: workspace.id,
        userId,
        role: persona.slot === 0 ? ("owner" as const) : ("member" as const),
      })),
    );
    await tx.insert(demoRoomSeats).values(
      bySlot.map(({ persona, userId }) => ({
        roomId,
        slot: persona.slot,
        userId,
        claimedAt: persona.slot === 0 ? new Date() : null,
      })),
    );
    await tx.update(tasks).set({ createdById: host.userId }).where(eq(tasks.boardId, boardId));

    return { roomId, workspaceId: workspace.id, boardId, userId: host.userId, persona: host.persona };
  });
}

/**
 * Seats a visitor in an existing room.
 *
 * 1. Returning visitor (their signed cookie is already locked to this room's
 *    workspace and names one of its seats) → same identity, lease refreshed.
 * 2. Otherwise, under a row lock on the room (serialises concurrent joins),
 *    hand out the FIRST seat that is neither live in presence nor inside its
 *    lease window. Seats whose holder has been gone > SEAT_LEASE_MS are recycled.
 * 3. All six live → "full".
 */
export async function joinDemoRoom(
  db: Database,
  presence: PresenceStore,
  roomId: string,
  current: { userId: string; workspaceId: string | null } | null,
): Promise<JoinResult> {
  const room = await findActiveRoom(db, roomId);
  if (!room) return { kind: "not_found" };

  // Read live presence BEFORE taking the lock — it may hit Redis; keep the lock short.
  const online = new Set((await presence.list(room.boardId)).map((u) => u.userId));

  return db.transaction(async (tx) => {
    await tx.select({ id: demoRooms.id }).from(demoRooms).where(eq(demoRooms.id, roomId)).for("update");
    const newExpiry = new Date(Date.now() + DEMO_ROOM_TTL_MS);

    const seats = await tx
      .select({ slot: demoRoomSeats.slot, userId: demoRoomSeats.userId, claimedAt: demoRoomSeats.claimedAt })
      .from(demoRoomSeats)
      .where(eq(demoRoomSeats.roomId, roomId))
      .orderBy(asc(demoRoomSeats.slot));

    const base = { roomId, workspaceId: room.workspaceId, boardId: room.boardId };

    if (current && current.workspaceId === room.workspaceId) {
      const mine = seats.find((s) => s.userId === current.userId);
      if (mine) {
        await tx
          .update(demoRoomSeats)
          .set({ claimedAt: new Date() })
          .where(and(eq(demoRoomSeats.roomId, roomId), eq(demoRoomSeats.slot, mine.slot)));
        await tx.update(demoRooms).set({ expiresAt: newExpiry }).where(eq(demoRooms.id, roomId));
        return { kind: "joined", reused: true, ...base, userId: mine.userId, persona: personaForSlot(mine.slot) };
      }
    }

    const leaseCutoff = Date.now() - SEAT_LEASE_MS;
    const free = seats.find(
      (s) => !online.has(s.userId) && (s.claimedAt === null || s.claimedAt.getTime() < leaseCutoff),
    );
    if (!free) return { kind: "full", roomId };

    await tx
      .update(demoRoomSeats)
      .set({ claimedAt: new Date() })
      .where(and(eq(demoRoomSeats.roomId, roomId), eq(demoRoomSeats.slot, free.slot)));
    await tx.update(demoRooms).set({ expiresAt: newExpiry }).where(eq(demoRooms.id, roomId));
    return { kind: "joined", reused: false, ...base, userId: free.userId, persona: personaForSlot(free.slot) };
  });
}

/** Seat occupancy for the room badge: how many personas are live right now. */
export async function roomOccupancy(
  presence: PresenceStore,
  room: Pick<DemoRoom, "boardId">,
): Promise<{ online: number; capacity: number }> {
  const online = (await presence.list(room.boardId)).length;
  return { online, capacity: ROOM_CAPACITY };
}

/**
 * Deletes expired rooms. One DELETE on `workspaces` cascades through boards,
 * columns, tasks, memberships, the room, its seats, its persona users and
 * their presence rows — nothing is left orphaned.
 */
export async function purgeExpiredDemoRooms(db: Database): Promise<number> {
  const expired = await db
    .select({ workspaceId: demoRooms.workspaceId })
    .from(demoRooms)
    .where(lt(demoRooms.expiresAt, sql`now()`))
    .limit(500);
  if (expired.length === 0) return 0;
  const deleted = await db
    .delete(workspaces)
    .where(
      inArray(
        workspaces.id,
        expired.map((r) => r.workspaceId),
      ),
    )
    .returning({ id: workspaces.id });
  return deleted.length;
}
