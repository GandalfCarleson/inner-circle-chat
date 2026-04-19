import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatar";

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-9 w-9 text-[11px]",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-base",
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({ name, url, size = "md", className }: AvatarProps) {
  const label = name?.trim() || "Unknown";
  const initials = initialsFromName(label);
  const resolvedUrl = resolveAvatarUrl(url);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full premium-border bg-[radial-gradient(circle_at_top,_rgba(255,248,231,0.18),_transparent_52%),linear-gradient(180deg,_rgba(44,47,54,0.96),_rgba(20,22,27,0.98))] text-[#f6f0e5] shadow-[0_14px_30px_rgba(0,0,0,0.22)]",
        sizeClasses[size],
        className,
      )}
      aria-label={label}
    >
      {resolvedUrl ? (
        <img src={resolvedUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-semibold tracking-[0.16em] text-white/88">
          {initials}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
    </div>
  );
}
