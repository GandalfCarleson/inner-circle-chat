import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listConversations, type ConversationSummary } from "@/lib/messaging";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Users, Settings, LogOut, Plus, Sparkles } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

interface Props {
  activeId?: string;
}

export function ChatSidebar({ activeId }: Props) {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [pendingFriends, setPendingFriends] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      const list = await listConversations(user.id);
      if (cancelled) return;
      setConvs(list);

      const next: Record<string, string> = {};
      for (const c of list) {
        if (!c.last_message) continue;
        if (c.last_message.type === "text") next[c.id] = c.last_message.ciphertext || "Say hi";
        else next[c.id] = c.last_message.type === "image" ? "Photo" : "Voice";
      }
      if (!cancelled) setPreviews(next);
    }
    load();

    supabase
      .from("friendships")
      .select("id", { count: "exact", head: true })
      .eq("addressee_id", user.id)
      .eq("status", "pending")
      .then(({ count }) => !cancelled && setPendingFriends(count ?? 0));

    const ch = supabase
      .channel("sidebar-messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => load())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [user]);

  function convTitle(c: ConversationSummary): string {
    if (c.name) return c.name;
    const others = c.members.filter((m) => m.user_id !== user?.id);
    if (others.length === 0) return "You";
    return others.map((o) => o.display_name || o.username).join(", ");
  }

  function convInitial(c: ConversationSummary): string {
    return convTitle(c).slice(0, 1).toUpperCase();
  }

  return (
    <aside className="flex h-full w-full flex-col bg-rail text-rail-foreground md:w-80 md:border-r md:border-border">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Halo</span>
        </Link>
        <Link
          to="/friends"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition hover:bg-secondary/70"
          aria-label="Friends"
        >
          <Plus className="h-4 w-4" />
          {pendingFriends > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {pendingFriends}
            </span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {convs.length === 0 ? (
          <div className="mt-10 px-4 text-center text-sm text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p>No chats yet.</p>
            <Link to="/friends" className="mt-2 inline-block text-primary hover:underline">
              Add a friend
            </Link>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {convs.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <Link
                    to="/chat/$id"
                    params={{ id: c.id }}
                    className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 transition ${
                      active ? "bg-secondary" : "hover:bg-secondary/60"
                    }`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-accent/80 text-sm font-semibold text-primary-foreground">
                      {convInitial(c)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{convTitle(c)}</p>
                        {c.last_message && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDistanceToNowStrict(new Date(c.last_message.created_at))
                              .replace(" minutes", "m")
                              .replace(" minute", "m")
                              .replace(" hours", "h")
                              .replace(" hour", "h")
                              .replace(" days", "d")
                              .replace(" day", "d")
                              .replace(" seconds", "s")
                              .replace(" second", "s")}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {previews[c.id] ?? (c.last_message ? "Message" : "Say hi")}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
            {(profile?.display_name || profile?.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{profile?.display_name || profile?.username}</p>
            <p className="truncate text-[11px] text-muted-foreground">@{profile?.username}</p>
          </div>
          <Link to="/friends" className="rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label="Friends">
            <Users className="h-4 w-4" />
          </Link>
          <Link to="/settings" className="rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={async () => {
              await signOut();
              router.navigate({ to: "/login" });
            }}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-destructive/20 hover:text-destructive"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
