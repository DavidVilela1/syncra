import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BoardShell } from "~/components/shell/board-shell";
import { SESSION_COOKIE, verifySession } from "~/server/auth/session";
import { db } from "~/server/db";
import { PERSONAS } from "~/lib/personas";
import { isRoomId } from "~/server/demo/room-id";
import { findActiveRoom } from "~/server/demo/rooms";

export const metadata: Metadata = { title: "Live Demo Room" };
export const dynamic = 'force-dynamic';


/**
 * The shared demo room. The proxy has already ensured the visitor holds a
 * session for THIS room; here we resolve the room to its board and hand the
 * room context (for the share button and welcome toast) to the client shell.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const roomId = typeof params.room === "string" ? params.room : null;
  if (!isRoomId(roomId)) redirect("/?error=invalid_room");

  const room = await findActiveRoom(db, roomId);
  if (!room) redirect("/?error=room_expired");

  // Belt and braces: the proxy checks the room id, we also check the workspace lock.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session || session.workspaceId !== room.workspaceId) redirect(`/api/auth/demo?room=${roomId}`);

  const welcomeHandle = typeof params.as === "string" ? params.as : null;
  const welcome = PERSONAS.find((p) => p.handle === welcomeHandle) ?? null;

  return (
    <BoardShell
      boardId={room.boardId}
      room={{
        id: room.id,
        expiresAt: room.expiresAt.toISOString(),
        welcome: welcome ? { name: welcome.name, title: welcome.title, avatarUrl: welcome.avatarUrl } : null,
      }}
    />
  );
}
