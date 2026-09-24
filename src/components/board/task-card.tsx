"use client";

import { Draggable } from "@hello-pangea/dnd";
import { clsx } from "clsx";
import { Clock3, Loader2 } from "lucide-react";
import { memo } from "react";
import { isOptimisticId } from "~/lib/board-cache";
import { formatRelativeShort, formatTaskKey } from "~/lib/format";
import type { BoardTask } from "~/trpc/shared";
import { PriorityFlag } from "./priority-flag";

interface TaskCardProps {
  task: BoardTask;
  index: number;
  workspaceKey: string;
  /** True when a search is active and this card doesn't match it. */
  dimmed: boolean;
}

/**
 * A draggable task card.
 *
 * Two-layer structure — the key to jank-free drag & drop:
 *  • The OUTER <li> belongs to the dnd library. It receives `draggableProps`
 *    (which include an inline `transform` the library animates every frame) and
 *    has NO transitions of its own. Putting `transition-all` here would make CSS
 *    tween the library's per-frame transforms → rubber-banding and a visible
 *    jump on drop. Spacing uses margin (not flex `gap`) because the library
 *    measures margin boxes when it makes room for the dragged card.
 *  • The INNER <article> owns every visual: hover ring, lift/tilt while
 *    dragging, and the settle-back while the drop animation plays. Its
 *    `transition-all duration-200` never fights the library.
 *
 * Memoized: the cache transforms preserve task identity, so only moved cards re-render.
 */
export const TaskCard = memo(function TaskCard({ task, index, workspaceKey, dimmed }: TaskCardProps) {
  const pending = isOptimisticId(task.id);
  const taskKey = pending ? `${workspaceKey}-···` : formatTaskKey(workspaceKey, task.number);

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={pending}>
      {(provided, snapshot) => {
        const lifted = snapshot.isDragging && !snapshot.isDropAnimating;
        return (
          <li
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            aria-roledescription="Draggable task"
            aria-label={`${taskKey}: ${task.title}`}
            className="group/card mb-2 list-none outline-none"
          >
            <article
              className={clsx(
                "relative rounded-xl border p-3 transition-all duration-200 ease-out",
                "group-focus-visible/card:border-accent/60 group-focus-visible/card:ring-2 group-focus-visible/card:ring-accent/30",
                lifted
                  ? [
                      "rotate-[1.25deg] scale-[1.02] cursor-grabbing border-accent/50 bg-[#16161a]",
                      "shadow-[0_24px_48px_-16px_rgba(0,0,0,0.9),0_0_0_1px_rgba(139,92,246,0.35),0_0_28px_-6px_rgba(139,92,246,0.45)]",
                    ]
                  : [
                      "border-hairline bg-elevated shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_1px_2px_rgba(0,0,0,0.4)]",
                      pending
                        ? "cursor-default border-dashed border-accent/30"
                        : "cursor-grab hover:-translate-y-px hover:border-accent/30 hover:bg-[#141417] hover:ring-1 hover:ring-accent/20 hover:shadow-[0_8px_24px_-12px_rgba(139,92,246,0.35)]",
                    ],
                dimmed && !snapshot.isDragging && "opacity-25 saturate-0",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={clsx(
                    "font-mono text-[11px] tracking-tight transition-colors duration-200",
                    lifted ? "text-accent" : "text-zinc-500 group-hover/card:text-zinc-400",
                  )}
                >
                  {taskKey}
                </span>
                <PriorityFlag priority={task.priority} />
              </div>

              <h3 className="mt-1.5 line-clamp-3 text-[13px] font-medium leading-5 text-zinc-100">{task.title}</h3>

              <div className="mt-3 flex items-center justify-between">
                {pending ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-accent">
                    <Loader2 className="size-3 animate-spin" />
                    syncing
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 font-mono text-[10.5px] text-zinc-600"
                    title={`Updated ${task.updatedAt.toLocaleString()}`}
                  >
                    <Clock3 className="size-3" />
                    {formatRelativeShort(task.updatedAt)}
                  </span>
                )}
                <span
                  aria-hidden
                  className="h-1 w-6 rounded-full bg-gradient-to-r from-transparent via-accent/0 to-accent/0 transition-all duration-200 group-hover/card:via-accent/40 group-hover/card:to-accent/70"
                />
              </div>
            </article>
          </li>
        );
      }}
    </Draggable>
  );
});
