import { createFileRoute, Link } from "@tanstack/react-router";
import { ChatSidebar } from "@/components/ChatSidebar";
import { MessageCircle, Sparkles, ShieldCheck, Zap, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Void - Your chats" },
      { name: "description", content: "Private messaging for your circle." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="screen-theme-inbox app-shell-bg flex h-app overflow-hidden">
      <ChatSidebar />
      <main className="hidden flex-1 flex-col items-center justify-center px-8 md:flex">
        <div className="premium-panel premium-elevated max-w-md rounded-[34px] px-10 py-12 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-[0_20px_34px_rgba(35,23,68,0.34)]">
            <Sparkles className="h-8 w-8 text-primary-foreground" />
          </div>
          <p className="lux-kicker">Void Messaging</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">Welcome to Void</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a chat from the left, or start one with a friend.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <Feature
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Simple"
              body="Chat without setup drama."
            />
            <Feature
              icon={<Zap className="h-4 w-4" />}
              title="Instant"
              body="Real-time messages, no clutter."
            />
            <Feature
              icon={<Users className="h-4 w-4" />}
              title="Your circle"
              body="Built for real friend groups."
            />
          </div>

          <Link
            to="/friends"
            className="premium-elevated mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <MessageCircle className="h-4 w-4" /> Add a friend
          </Link>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="premium-panel-soft rounded-xl p-3">
      <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </div>
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
