import { Circle, CircleCheck, CircleDashed, CircleDot, CircleEllipsis, CircleX } from "lucide-react";

/** Linear-style workflow glyph inferred from the column's name. */
export function ColumnStatusIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const cls = "size-3.5 shrink-0";
  if (/(done|complete|shipped|closed)/.test(n)) return <CircleCheck className={`${cls} text-accent`} />;
  if (/(cancel|won.?t|reject)/.test(n)) return <CircleX className={`${cls} text-zinc-600`} />;
  if (/(review|qa|testing|verify)/.test(n)) return <CircleEllipsis className={`${cls} text-sky-400`} />;
  if (/(progress|doing|active|wip)/.test(n)) return <CircleDot className={`${cls} text-amber-300`} />;
  if (/(backlog|icebox|later)/.test(n)) return <CircleDashed className={`${cls} text-zinc-600`} />;
  return <Circle className={`${cls} text-zinc-400`} />;
}
