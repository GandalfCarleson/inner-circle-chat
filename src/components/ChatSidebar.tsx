import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getConversationPreview,
  listConversations,
  listUnreadCounts,
  type ConversationSummary,
} from "@/lib/messaging";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import { NewChatDialog } from "@/components/NewChatDialog";
import { MessageCircle, Users, Settings, LogOut, Plus, Sparkles, Search } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

interface Props {
  activeId?: string;
}

function getConversationTitle(conversation: ConversationSummary, currentUserId?: string) {
  if (conversation.name) return conversation.name;
  const others = conversation.members.filter((member) => member.user_id !== currentUserId);
  if (others.length === 0) return "You";
  return others.map((member) => member.display_name || member.username).join(", ");
}

function formatConversationTime(dateString: string) {
  return formatDistanceToNowStrict(new Date(dateString))
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" seconds", "s")
    .replace(" second", "s");
}

function getConversationAvatarUrl(conversation: ConversationSummary, currentUserId?: string) {
  if (conversation.avatar_url) return conversation.avatar_url;
  if (conversation.type === "group") return null;

  const otherMember = conversation.members.find((member) => member.user_id !== currentUserId);
  return otherMember?.avatar_url ?? null;
}

export function ChatSidebar({ activeId }: Props) {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [pendingFriends, setPendingFriends] = useState(0);
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadSidebarState() {
      try {
        const [loadedConversations, nextUnreadCounts, pendingCountResult] = await Promise.all([
          listConversations(user.id),
          listUnreadCounts(user.id),
          supabase
            .from("friendships")
            .select("id", { count: "exact", head: true })
            .eq("addressee_id", user.id)
            .eq("status", "pending"),
        ]);

        if (cancelled) return;
        setConversations(loadedConversations);
        setUnreadCounts(nextUnreadCounts);
        setPendingFriends(pendingCountResult.count ?? 0);
      } catch (error) {
        console.error("Failed to load sidebar state", error);
        if (!cancelled) {
          setConversations([]);
          setUnreadCounts({});
          setPendingFriends(0);
        }
      }
    }

    void loadSidebarState();

    // Sidebar only needs lightweight refresh triggers, not full message polling.
    const channel = supabase
      .channel("sidebar-messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        void loadSidebarState();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` },
        () => {
          void loadSidebarState();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const filteredConversations = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return conversations;

    return conversations.filter((conversation) => {
      const title = getConversationTitle(conversation, user?.id).toLowerCase();
      const preview = getConversationPreview(conversation.last_message).toLowerCase();
      return title.includes(term) || preview.includes(term);
    });
  }, [conversations, query, user?.id]);

  const navButtonClass =
    "interactive-surface quiet-hover inline-flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:h-11 md:w-11 h-12 w-12";

  return (
    <aside className="app-shell-bg shell-noise relative flex h-full min-h-0 w-full flex-col overflow-hidden md:w-[27rem] md:flex-row premium-border md:rounded-[28px]">
      <div className="hidden w-[5.5rem] flex-col items-center justify-between border-r subtle-divider bg-white/[0.02] px-4 py-5 md:flex">
        <div className="flex flex-col items-center gap-4">
          <Link
            to="/"
            className="premium-panel quiet-hover flex h-14 w-14 items-center justify-center rounded-[22px] text-[13px] font-semibold tracking-[0.26em] text-primary"
          >
            Void
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
        <div className="safe-top-tight border-b subtle-divider px-4 pb-4 pt-3 md:px-5 md:pb-5 md:pt-5">
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
            <button
              type="button"
              onClick={() => setNewChatOpen(true)}
              className="premium-panel quiet-hover relative inline-flex h-12 w-12 items-center justify-center rounded-2xl text-foreground"
              aria-label="Start chat"
            >
              <Plus className="h-4 w-4" />
              {pendingFriends > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {pendingFriends}
                </span>
              )}
            </button>
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

        <div className="mobile-scroll-padding flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
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
              {filteredConversations.map((conversation) => {
                const active = conversation.id === activeId;
                const title = getConversationTitle(conversation, user?.id);
                const preview = getConversationPreview(conversation.last_message);
                const unreadCount = unreadCounts[conversation.id] ?? 0;

                return (
                  <li key={conversation.id}>
                    <Link
                      to="/chat/$id"
                      params={{ id: conversation.id }}
                      className={`quiet-hover flex items-center gap-3 rounded-[24px] border px-3 py-3.5 min-h-[4.5rem] ${
                        active
                          ? "conversation-selected"
                          : "interactive-surface border-transparent hover:border-white/8"
                      }`}
                    >
                      <Avatar
                        name={title}
                        url={getConversationAvatarUrl(conversation, user?.id)}
                        size="md"
                      />
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
                            {unreadCount > 0 ? (
                              <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </span>
                            ) : (
                              active && <span className="h-2 w-2 rounded-full bg-primary" />
                            )}
                            {conversation.last_message && (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-white/34">
                                {formatConversationTime(conversation.last_message.created_at)}
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

        <div className="safe-bottom border-t subtle-divider px-4 py-3 md:px-5 md:py-4">
          <div className="premium-panel-soft flex items-center gap-3 rounded-[24px] px-3 py-3">
            <Avatar name={profile?.display_name || profile?.username || "Unknown"} size="sm" />
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

      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
    </aside>
  );
}
