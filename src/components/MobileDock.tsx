import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MessageCircle, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileDockProps {
  active: "inbox" | "friends" | "profile";
}

function DockItem({
  to,
  icon,
  active,
}: {
  to: "/" | "/friends" | "/settings";
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      data-active={active}
      className={cn(
        "dock-item quiet-hover inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full px-3 py-2 text-xs tracking-[0.08em]",
        active ? "nav-active" : "text-muted-foreground hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      {icon}
    </Link>
  );
}

export function MobileDock({ active }: MobileDockProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.65rem,env(safe-area-inset-bottom))] md:hidden">
      <nav className="mobile-dock-compact glass-dock pointer-events-auto mx-auto flex max-w-sm items-center gap-1 rounded-[24px] p-1.5 screen-enter">
        <DockItem to="/" icon={<MessageCircle className="h-4 w-4" />} active={active === "inbox"} />
        <DockItem to="/friends" icon={<Users className="h-4 w-4" />} active={active === "friends"} />
        <DockItem to="/settings" icon={<UserRound className="h-4 w-4" />} active={active === "profile"} />
      </nav>
    </div>
  );
}
