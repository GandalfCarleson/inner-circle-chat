import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MessageCircle, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileDockProps {
  active: "inbox" | "friends" | "profile";
}

function DockItem({
  to,
  label,
  icon,
  active,
}: {
  to: "/" | "/friends" | "/settings";
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "quiet-hover inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs tracking-[0.08em]",
        active ? "bg-white/12 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function MobileDock({ active }: MobileDockProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.65rem,env(safe-area-inset-bottom))] md:hidden">
      <nav className="glass-dock pointer-events-auto mx-auto flex max-w-sm items-center gap-1 rounded-[24px] p-1.5">
        <DockItem
          to="/"
          label="Inbox"
          icon={<MessageCircle className="h-3.5 w-3.5" />}
          active={active === "inbox"}
        />
        <DockItem
          to="/friends"
          label="Friends"
          icon={<Users className="h-3.5 w-3.5" />}
          active={active === "friends"}
        />
        <DockItem
          to="/settings"
          label="Profile"
          icon={<UserRound className="h-3.5 w-3.5" />}
          active={active === "profile"}
        />
      </nav>
    </div>
  );
}
