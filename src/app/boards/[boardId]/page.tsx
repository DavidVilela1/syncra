import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BoardShell } from "~/components/shell/board-shell";
import { SESSION_COOKIE, verifySession } from "~/server/auth/session";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!z.uuid().safeParse(boardId).success) notFound();

  // Demo visitors always live at their shareable room URL, so the address bar
  // (and the Share button) keep the invite link — e.g. after clicking the
  // board in the sidebar.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (session?.roomId) redirect(`/dashboard?room=${session.roomId}`);

  return <BoardShell boardId={boardId} room={null} />;
}
