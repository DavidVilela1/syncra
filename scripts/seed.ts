import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users, workspaceMembers, workspaces } from "~/server/db/schema";
import { PERSONAS } from "~/lib/personas";
import { FIRST_TASK_NUMBER, SEED_BOARDS, insertBoardFromTemplate } from "~/server/demo/template";

/**
 * Seeds a persistent (non-demo) "Syncra" workspace with three boards and the
 * first three personas. For the public, self-serve experience use the landing
 * page's "Create Live Demo Room" instead — this script is for local development.
 */
async function main() {
  const stamp = Date.now().toString(36);
  const cast = PERSONAS.slice(0, 3);

  const result = await db.transaction(async (tx) => {
    const people = await tx
      .insert(users)
      .values(cast.map((p) => ({ email: `${p.handle}+${stamp}@syncra.dev`, name: p.name, avatarUrl: p.avatarUrl })))
      .returning();
    const [alice] = people;
    if (!alice || people.length !== cast.length) throw new Error("user insert failed");

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: "Syncra", slug: `syncra-${stamp}`, key: "SYN" })
      .returning();
    if (!workspace) throw new Error("workspace insert failed");

    await tx.insert(workspaceMembers).values(
      people.map((u, i) => ({
        workspaceId: workspace.id,
        userId: u.id,
        role: i === 0 ? ("owner" as const) : ("member" as const),
      })),
    );

    // now() is frozen for the whole transaction, so stagger createdAt explicitly
    // to keep the sidebar in the order the boards are declared.
    const baseTime = Date.now();
    let nextNumber = FIRST_TASK_NUMBER;
    let firstBoardId: string | null = null;
    for (const [boardIndex, template] of SEED_BOARDS.entries()) {
      const inserted = await insertBoardFromTemplate(tx, {
        workspaceId: workspace.id,
        template,
        firstNumber: nextNumber,
        createdById: alice.id,
        createdAt: new Date(baseTime + boardIndex * 1000),
      });
      nextNumber = inserted.nextNumber;
      firstBoardId ??= inserted.boardId;
    }

    await tx
      .update(workspaces)
      .set({ taskSeq: nextNumber - 1 })
      .where(eq(workspaces.id, workspace.id));
    if (!firstBoardId) throw new Error("no boards seeded");
    return { people, firstBoardId };
  });

  // APP_URL lets the same script print working links for a deployed app.
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const next = encodeURIComponent(`/boards/${result.firstBoardId}`);
  console.log("\nSeeded workspace “Syncra”. Open each link in a different browser/profile:\n");
  for (const person of result.people) {
    console.log(`  ${person.name.padEnd(13)} → ${appUrl}/api/dev/login?userId=${person.id}&next=${next}`);
  }
  console.log(`\nOr open ${appUrl} and click “Create Live Demo Room”.\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
