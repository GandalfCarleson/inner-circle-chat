import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePresence } from "@/contexts/PresenceContext";
import {
  getConversationPreview,
  listConversations,
  listUnreadCounts,
  type ConversationSummary,
} from "@/lib/messaging";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import { ConstellationLayer, type ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { NewChatDialog } from "@/components/NewChatDialog";
import {
  MessageCircle,
  Users,
  UserRound,
  LogOut,
  Plus,
  Sparkles,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

interface Props {
  activeId?: string;
}

interface PresencePreviewMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  lastActiveAt: string | null;
  conversationId: string | null;
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
  const { onlineByUserId, lastSeenByUserId } = usePresence();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [pendingFriends, setPendingFriends] = useState(0);
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [constellationSignal, setConstellationSignal] = useState<ConstellationSignal>({
    kind: "focus",
    key: 0,
  });

  function emitConstellationSignal(kind: ConstellationSignal["kind"]) {
    setConstellationSignal((current) => ({ kind, key: current.key + 1 }));
  }

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
        {
          event: "*",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${user.id}`,
        },
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

  const presenceMembers = useMemo<PresencePreviewMember[]>(() => {
    const byUserId = new Map<string, PresencePreviewMember>();

    for (const conversation of conversations) {
      for (const member of conversation.members) {
        if (!user || member.user_id === user.id) continue;

        const existing = byUserId.get(member.user_id);
        const conversationActivityAt =
          conversation.last_message?.created_at ?? conversation.updated_at;
        const lastActiveAt =
          onlineByUserId[member.user_id]?.last_active_at ??
          lastSeenByUserId[member.user_id] ??
          conversationActivityAt;
        const candidate: PresencePreviewMember = {
          id: member.user_id,
          name: member.display_name || member.username || "Unknown",
          avatarUrl: member.avatar_url,
          online: Boolean(onlineByUserId[member.user_id]),
          lastActiveAt,
          conversationId: conversation.type === "dm" ? conversation.id : null,
        };

        if (!existing) {
          byUserId.set(member.user_id, candidate);
          continue;
        }

        const existingActivityTime = existing.lastActiveAt
          ? new Date(existing.lastActiveAt).getTime()
          : 0;
        const candidateActivityTime = candidate.lastActiveAt
          ? new Date(candidate.lastActiveAt).getTime()
          : 0;

        if (
          Number(candidate.online) > Number(existing.online) ||
          candidateActivityTime > existingActivityTime
        ) {
          byUserId.set(member.user_id, candidate);
        }
      }
    }

    return Array.from(byUserId.values())
      .sort((a, b) => {
        if (a.online !== b.online) return Number(b.online) - Number(a.online);
        const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 12);
  }, [conversations, lastSeenByUserId, onlineByUserId, user]);

  const navButtonClass =
    "interactive-surface quiet-hover inline-flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:h-11 md:w-11 h-12 w-12 premium-elevated";

  useEffect(() => {
    emitConstellationSignal("focus");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unreadTotal = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
    if (unreadTotal > 0) {
      emitConstellationSignal("incoming");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCounts]);

  useEffect(() => {
    const onlineCount = presenceMembers.filter((member) => member.online).length;
    if (onlineCount > 0) {
      emitConstellationSignal("typing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceMembers]);

  return (
    <aside className="screen-theme-inbox inbox-shell-bg shell-noise screen-enter relative flex h-full min-h-0 w-full flex-col overflow-hidden premium-border md:w-[27rem] md:flex-row md:rounded-[34px]">
      <ConstellationLayer mode="inbox" signal={constellationSignal} className="opacity-[0.62]" />

      <div className="relative z-10 hidden w-[5.5rem] flex-col items-center justify-between border-r subtle-divider bg-black/16 px-4 py-5 md:flex">
        <div className="flex flex-col items-center gap-4">
          <Link
            to="/"
            className="glass-dock quiet-hover flex h-14 w-14 items-center justify-center rounded-[22px] text-[12px] font-medium tracking-[0.28em] text-foreground"
          >
            VOID
          </Link>
          <Link to="/friends" className={navButtonClass} aria-label="Friends">
            <Users className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Link to="/settings" className={navButtonClass} aria-label="Profile">
            <UserRound className="h-4 w-4" />
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

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="safe-top-tight border-b subtle-divider px-4 pb-4 pt-3 md:px-5 md:pb-5 md:pt-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                name={profile?.display_name || profile?.username || "Void"}
                url={profile?.avatar_url}
                size="sm"
                className="h-11 w-11"
              />
              <div>
                <p className="lux-kicker">Void</p>
                <h2 className="lux-title mt-1.5 text-[1.6rem]">Chats</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewChatOpen(true)}
              className="glass-dock quiet-hover relative inline-flex h-12 w-12 items-center justify-center rounded-2xl text-foreground"
              aria-label="Start chat"
            >
              <Plus className="h-4 w-4" />
              {pendingFriends > 0 && (
                <span className="unread-pill absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                  {pendingFriends}
                </span>
              )}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <div className="glass-dock flex flex-1 items-center gap-3 rounded-[22px] px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              className="search-ghost-btn interactive-surface quiet-hover inline-flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground"
              aria-label="Filter conversations"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>

          {presenceMembers.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/38">Active now</p>
                <p className="text-[10px] text-white/28">{presenceMembers.length}</p>
              </div>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setNewChatOpen(true)}
                  className="presence-user-card quiet-hover surface-secondary flex min-w-0 shrink-0 flex-col items-center gap-1.5 rounded-[18px] px-1.5 py-2 text-center"
                >
                  <div className="presence-ring flex h-12 w-12 items-center justify-center rounded-full bg-black/30 text-foreground">
                    <Plus className="h-4 w-4" />
                  </div>
                  <p className="max-w-[3.5rem] truncate text-[11px] text-foreground/90">Your note</p>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-white/34">New</p>
                </button>
                {presenceMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      if (!member.conversationId) return;
                      router.navigate({ to: "/chat/$id", params: { id: member.conversationId } });
                    }}
                    disabled={!member.conversationId}
                    data-online={member.online}
                    className="presence-user-card quiet-hover surface-secondary flex min-w-0 shrink-0 flex-col items-center gap-1.5 rounded-[18px] px-1.5 py-2 text-center disabled:cursor-default"
                  >
                    <div className="relative">
                      <div className={`presence-ring ${member.online ? "is-online" : ""}`}>
                        <Avatar
                          name={member.name}
                          url={member.avatarUrl}
                          size="sm"
                          className="h-12 w-12 text-[11px]"
                        />
                      </div>
                      <span
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0b1220] ${
                          member.online
                            ? "online-pulse bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.22)]"
                            : "bg-white/38"
                        }`}
                      />
                    </div>
                    <p className="max-w-[3.5rem] truncate text-[11px] text-foreground/90">
                      {member.name}
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.08em] text-white/34">
                      {member.online
                        ? "Online"
                        : member.lastActiveAt
                          ? `${formatConversationTime(member.lastActiveAt)} ago`
                          : "Away"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mobile-scroll-padding flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
          {filteredConversations.length === 0 ? (
            <div className="premium-panel-soft mx-2 mt-8 rounded-[28px] px-6 py-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/70">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-medium tracking-[-0.02em] text-foreground">
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
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground quiet-hover premium-elevated hover:opacity-95"
                >
                  <Sparkles className="h-4 w-4" /> Start a conversation
                </Link>
              )}
            </div>
          ) : (
            <ul className="space-y-2.5">
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
                      data-active={active}
                      className={`inbox-conversation-card quiet-hover premium-elevated flex min-h-[4.5rem] items-center gap-3 rounded-[24px] border px-3 py-3.5 ${
                        active
                          ? "conversation-selected surface-highlight"
                          : "interactive-surface border-transparent hover:border-white/10"
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
                              <span className="unread-pill inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </span>
                            ) : (
                              active && <span className="h-2 w-2 rounded-full bg-primary" />
                            )}
                            {conversation.last_message && (
                              <span className="text-[10px] uppercase tracking-[0.16em] text-white/32">
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
          <div className="glass-dock flex items-center gap-3 rounded-[24px] px-3 py-3">
            <Avatar name={profile?.display_name || profile?.username || "Unknown"} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.display_name || profile?.username}
              </p>
              <p className="truncate text-[11px] uppercase tracking-[0.15em] text-white/34">
                @{profile?.username}
              </p>
            </div>
            <div className="glass-dock flex items-center gap-1 rounded-full p-1 md:hidden">
              <Link to="/friends" className={navButtonClass} aria-label="Friends">
                <Users className="h-4 w-4" />
              </Link>
              <Link to="/settings" className={navButtonClass} aria-label="Profile">
                <UserRound className="h-4 w-4" />
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
