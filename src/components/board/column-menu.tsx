"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Copy, FoldHorizontal, MoreHorizontal, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

interface ColumnMenuProps {
  columnId: string;
  columnName: string;
  onAddTask: () => void;
  onCollapse: () => void;
}

export function ColumnMenu({ columnId, columnName, onAddTask, onCollapse }: ColumnMenuProps) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(columnId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${columnName} options`}
          className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 transition-all duration-200 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-white/[0.06] data-[state=open]:text-zinc-200"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 animate-fade-in rounded-lg border border-hairline-strong bg-overlay p-1 shadow-2xl shadow-black/60"
        >
          <DropdownMenu.Label className="px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {columnName}
          </DropdownMenu.Label>
          <MenuItem icon={<Plus className="size-3.5" />} onSelect={onAddTask}>
            Add task
          </MenuItem>
          <MenuItem icon={<FoldHorizontal className="size-3.5" />} onSelect={onCollapse}>
            Collapse column
          </MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
          <MenuItem
            icon={copied ? <Check className="size-3.5 text-neon" /> : <Copy className="size-3.5" />}
            onSelect={(event) => {
              event.preventDefault();
              void copyId();
            }}
          >
            {copied ? "Copied" : "Copy column ID"}
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon,
  children,
  onSelect,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: (event: Event) => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-zinc-300 outline-none transition-colors duration-150 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white"
    >
      <span className="text-zinc-500">{icon}</span>
      {children}
    </DropdownMenu.Item>
  );
}
