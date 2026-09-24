import { describe, expect, it } from "vitest";
import { applyTaskPlacement, computeTargetPosition } from "./board-cache";

const t0 = new Date("2026-01-01T00:00:00Z");
const t1 = new Date("2026-01-01T00:00:01Z");

const task = (id: string, columnId: string, position: string) => ({ id, columnId, position, updatedAt: t0, title: id });

function makeBoard() {
  return {
    id: "board",
    columns: [
      { id: "todo", tasks: [task("a", "todo", "a0"), task("b", "todo", "a1"), task("c", "todo", "a2")] },
      { id: "done", tasks: [task("d", "done", "a0")] },
      { id: "empty", tasks: [] as ReturnType<typeof task>[] },
    ],
  };
}

const ids = (board: ReturnType<typeof makeBoard>, col: number) => board.columns[col]!.tasks.map((t) => t.id);

describe("computeTargetPosition", () => {
  it("places at top, middle, end and into an empty column", () => {
    const b = makeBoard();
    expect(computeTargetPosition(b, "c", "todo", null) < "a0").toBe(true);
    const mid = computeTargetPosition(b, "c", "todo", "a");
    expect(mid > "a0" && mid < "a1").toBe(true);
    expect(computeTargetPosition(b, "a", "todo", "c") > "a2").toBe(true);
    expect(computeTargetPosition(b, "a", "empty", null)).toBe("a0");
  });

  it("ignores the moving task when choosing neighbours", () => {
    const b = makeBoard();
    // Moving b to "after a" is its current slot → key between a0 and a2 (b's own a1 excluded).
    const k = computeTargetPosition(b, "b", "todo", "a");
    expect(k > "a0" && k < "a2").toBe(true);
  });
});

describe("applyTaskPlacement", () => {
  it("moves across columns and keeps sort order", () => {
    const b = makeBoard();
    const next = applyTaskPlacement(b, { taskId: "a", toColumnId: "done", position: "a1", updatedAt: t1 });
    expect(ids(next, 0)).toEqual(["b", "c"]);
    expect(ids(next, 1)).toEqual(["d", "a"]);
    expect(next.columns[1]!.tasks[1]!.columnId).toBe("done");
  });

  it("preserves identity of untouched columns and does not mutate input", () => {
    const b = makeBoard();
    const snapshot = JSON.stringify(b);
    const next = applyTaskPlacement(b, { taskId: "c", toColumnId: "todo", position: "Zz", updatedAt: t1 });
    expect(ids(next, 0)).toEqual(["c", "a", "b"]);
    expect(next.columns[1]).toBe(b.columns[1]);
    expect(next.columns[2]).toBe(b.columns[2]);
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  it("is idempotent and ignores stale events (LWW)", () => {
    const b = makeBoard();
    const p = { taskId: "a", toColumnId: "done", position: "a1", updatedAt: t1 };
    const once = applyTaskPlacement(b, p);
    expect(applyTaskPlacement(once, p)).toBe(once);
    const stale = applyTaskPlacement(once, { ...p, toColumnId: "todo", position: "a5", updatedAt: t0 }, { ignoreIfStale: true });
    expect(stale).toBe(once);
  });

  it("returns the same board for unknown tasks", () => {
    const b = makeBoard();
    expect(applyTaskPlacement(b, { taskId: "zzz", toColumnId: "todo", position: "a9", updatedAt: t1 })).toBe(b);
  });
});

import { insertTask, isOptimisticId, removeTask } from "./board-cache";

describe("insertTask / removeTask", () => {
  it("inserts in key order, idempotently", () => {
    const b = makeBoard();
    const t = task("x", "todo", "a0V");
    const next = insertTask(b, t);
    expect(ids(next, 0)).toEqual(["a", "x", "b", "c"]);
    expect(insertTask(next, t)).toBe(next);
    expect(next.columns[1]).toBe(b.columns[1]);
  });

  it("removes and is a no-op for unknown ids", () => {
    const b = makeBoard();
    expect(ids(removeTask(b, "b"), 0)).toEqual(["a", "c"]);
    expect(removeTask(b, "nope")).toBe(b);
  });

  it("recognises optimistic ids", () => {
    expect(isOptimisticId("optimistic:123")).toBe(true);
    expect(isOptimisticId("5b8c…")).toBe(false);
  });
});
