"use client";

import { clsx } from "clsx";
import { CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BoardTask } from "~/trpc/shared";
import { PRIORITY_CYCLE, PRIORITY_META, PriorityFlag } from "./priority-flag";

type Priority = BoardTask["priority"];

interface TaskComposerProps {
  onSubmit: (input: { title: string; priority: Priority }) => void;
  onClose: () => void;
}

/**
 * Inline "new task" composer. Enter submits and keeps the composer open for
 * rapid entry (Linear-style); Escape or an empty blur closes it.
 */
export function TaskComposer({ onSubmit, onClose }: TaskComposerProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    // In a long column the composer mounts below the fold — bring it into view.
    input?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const trimmed = title.trim();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed) return;
    onSubmit({ title: trimmed, priority });
    setTitle("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function cyclePriority() {
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(priority) + 1) % PRIORITY_CYCLE.length];
    if (next) setPriority(next);
  }

  return (
    <form
      onSubmit={submit}
      className="mb-2 animate-slide-up rounded-xl border border-accent/40 bg-elevated p-2.5 shadow-[0_0_0_3px_rgba(139,92,246,0.12)] transition-all duration-200"
    >
      <label htmlFor="new-task-title" className="sr-only">
        Task title
      </label>
      <textarea
        id="new-task-title"
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!trimmed) onClose();
        }}
        rows={2}
        maxLength={256}
        placeholder="What needs to be done?"
        className="w-full resize-none bg-transparent px-0.5 text-[13px] leading-5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cyclePriority}
          title={`Priority: ${PRIORITY_META[priority].label} (click to change)`}
          className="rounded-md transition-all duration-200 hover:brightness-125"
        >
          <PriorityFlag priority={priority} showNone />
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">esc</span>
          <button
            type="submit"
            onMouseDown={(e) => e.preventDefault()}
            disabled={!trimmed}
            className={clsx(
              "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-all duration-200",
              trimmed
                ? "bg-accent text-white shadow-[0_0_16px_-4px_rgba(139,92,246,0.8)] hover:bg-accent-strong"
                : "bg-white/[0.04] text-zinc-600",
            )}
          >
            Add
            <CornerDownLeft className="size-3" />
          </button>
        </div>
      </div>
    </form>
  );
}
