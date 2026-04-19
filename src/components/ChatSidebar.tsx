import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listConversations, type ConversationSummary } from "@/lib/messaging";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import { MessageCircle, Users, Settings, LogOut, Plus, Sparkles, Search } from "lucide-react";
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
  const [query, setQuery] = useState("");

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
        else next[c.id] = c.last_message.type === "image" ? "Photo" : "Voice note";
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

  const filteredConversations = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return convs;
    return convs.filter((c) => {
      const title = convTitle(c).toLowerCase();
      const preview = (previews[c.id] ?? "").toLowerCase();
      return title.includes(term) || preview.includes(term);
    });
  }, [convs, previews, query]);

  const navButtonClass =
    "interactive-surface quiet-hover inline-flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground";

  return (
    <aside className="app-shell-bg shell-noise relative flex h-full w-full flex-col overflow-hidden md:w-[27rem] md:flex-row premium-border md:rounded-[28px]">
      <div className="hidden md:flex w-[5.5rem] flex-col items-center justify-between border-r subtle-divider bg-white/[0.02] px-4 py-5">
        <div className="flex flex-col items-center gap-4">
          <Link
            to="/"
            className="premium-panel quiet-hover flex h-14 w-14 items-center justify-center rounded-[22px] text-[13px] font-semibold tracking-[0.26em] text-primary"
          >
            VD
          </Link>
          <Link to="/friends" className={navButtonClass} aria-label="Friends">
            <Users className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Link to="/settings" className={navButtonClass} aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={async () => {
              await signOut();
              router.navigate({ to: "/login" });
            }}
            className={navButtonClass}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b subtle-divider px-4 pb-4 pt-5 md:px-5 md:pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/38">Void</p>
              <h2 className="mt-2 text-[1.55rem] font-semibold tracking-[-0.03em] text-foreground">
                Conversations
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A quieter place for the people that matter.
              </p>
            </div>
            <Link
              to="/friends"
              className="premium-panel quiet-hover relative inline-flex h-11 w-11 items-center justify-center rounded-2xl text-foreground"
              aria-label="Start chat"
            >
              <Plus className="h-4 w-4" />
              {pendingFriends > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {pendingFriends}
                </span>
              )}
            </Link>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-[22px] premium-panel-soft px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
          {filteredConversations.length === 0 ? (
            <div className="premium-panel-soft mx-2 mt-8 rounded-[28px] px-6 py-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.035] text-white/70 premium-border">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-medium text-foreground">
                {query ? "No matching conversations" : "Your inbox is quiet"}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                {query
                  ? "Try a different name or preview phrase."
                  : "Start a new conversation with someone from your circle."}
              </p>
              {!query && (
                <Link
                  to="/friends"
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground quiet-hover hover:opacity-95"
                >
                  <Sparkles className="h-4 w-4" /> Start a conversation
                </Link>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredConversations.map((c) => {
                const active = c.id === activeId;
                const title = convTitle(c);
                const preview = previews[c.id] ?? (c.last_message ? "Message" : "Say hi");

                return (
                  <li key={c.id}>
                    <Link
                      to="/chat/$id"
                      params={{ id: c.id }}
                      className={`quiet-hover flex items-center gap-3 rounded-[24px] border px-3 py-3.5 ${
                        active
                          ? "conversation-selected"
                          : "interactive-surface border-transparent hover:border-white/8"
                      }`}
                    >
                      <Avatar name={title} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium tracking-[-0.01em] text-foreground">
                              {title}
                            </p>
                            <p className="mt-1 truncate text-[12px] text-muted-foreground">
                              {preview}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 pt-0.5">
                            {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                            {c.last_message && (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-white/34">
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
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t subtle-divider px-4 py-4 md:px-5">
          <div className="premium-panel-soft flex items-center gap-3 rounded-[24px] px-3 py-3">
            <Avatar
              name={profile?.display_name || profile?.username || "Unknown"}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.display_name || profile?.username}
              </p>
              <p className="truncate text-[11px] uppercase tracking-[0.18em] text-white/36">
                @{profile?.username}
              </p>
            </div>
            <div className="flex items-center gap-1 md:hidden">
              <Link to="/friends" className={navButtonClass} aria-label="Friends">
                <Users className="h-4 w-4" />
              </Link>
              <Link to="/settings" className={navButtonClass} aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={async () => {
                  await signOut();
                  router.navigate({ to: "/login" });
                }}
                className={navButtonClass}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
