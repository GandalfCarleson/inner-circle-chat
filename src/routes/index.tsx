import { createFileRoute, Link } from "@tanstack/react-router";
import { ChatSidebar } from "@/components/ChatSidebar";
import { MessageCircle, Sparkles, ShieldCheck, Zap, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Halo - Your chats" },
      { name: "description", content: "Private messaging for your circle." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex h-app overflow-hidden bg-background">
      <ChatSidebar />
      <main className="hidden flex-1 flex-col items-center justify-center px-8 md:flex">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <Sparkles className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Halo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a chat from the left, or start one with a friend.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Simple" body="Chat without setup drama." />
            <Feature icon={<Zap className="h-4 w-4" />} title="Instant" body="Real-time messages, no clutter." />
            <Feature icon={<Users className="h-4 w-4" />} title="Your circle" body="Built for real friend groups." />
          </div>

          <Link
            to="/friends"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
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
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </div>
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
