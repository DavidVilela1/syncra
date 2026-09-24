import { clsx } from "clsx";
import { hueFromId, initials } from "~/lib/format";

interface UserAvatarProps {
  userId: string;
  name: string;
  avatarUrl: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
} as const;

/**
 * Profile picture, or a deterministic gradient monogram when the user has none —
 * the same person always gets the same colours across every client.
 */
export function UserAvatar({ userId, name, avatarUrl, size = "sm", className }: UserAvatarProps) {
  const base = clsx("relative inline-flex shrink-0 select-none items-center justify-center rounded-full", SIZES[size], className);

  if (avatarUrl) {
    return (
      // Remote avatars come from arbitrary auth-provider hosts; next/image would need each host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name} className={clsx(base, "object-cover")} draggable={false} />
    );
  }

  const hue = hueFromId(userId);
  return (
    <span
      role="img"
      aria-label={name}
      className={clsx(base, "font-semibold tracking-tight text-white/95")}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 72% 58%), hsl(${(hue + 48) % 360} 70% 42%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}
