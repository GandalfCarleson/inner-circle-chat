import { createFileRoute, useRouter } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, MessageCircle, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { type ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import {
  FriendsNetworkHub,
} from "@/components/constellation/FriendsNetworkHub";
import { MobileDock } from "@/components/MobileDock";
import { useAuth } from "@/contexts/AuthContext";
import { usePresence } from "@/contexts/PresenceContext";
import { useGradient } from "@/hooks/useGradient";
import {
  useSocialGraph,
  type SocialGraphNode,
} from "@/hooks/useSocialGraph";
import { supabase } from "@/integrations/supabase/client";
import { findOrCreateDM, listConversations } from "@/lib/messaging";
import { countMessagesByConversationIds } from "@/lib/socialGraphData";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [{ title: "Friends - Void" }],
  }),
  component: FriendsPage,
});

interface ProfileSummary {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface FriendshipRow {
  id: string;
  status: "pending" | "accepted" | "blocked";
  requester_id: string;
  addressee_id: string;
  other: ProfileSummary | null;
}

interface FriendInteractionMetric {
  conversationId: string | null;
  totalMessages: number;
  lastMessageAt: string | null;
}

function FriendsPage() {
  const { user } = useAuth();
  const { isUserOnline } = usePresence();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSummary[]>([]);
  const [friends, setFriends] = useState<FriendshipRow[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedNetworkFriendId, setSelectedNetworkFriendId] = useState<string | null>(null);
  const [friendMetricsById, setFriendMetricsById] = useState<Record<string, FriendInteractionMetric>>(
    {},
  );
  const [spawnedFriendIds, setSpawnedFriendIds] = useState<Record<string, true>>({});
  const [constellationSignal, setConstellationSignal] = useState<ConstellationSignal>({
    kind: "focus",
    key: 0,
  });
  const acceptedSnapshotRef = useRef<Set<string>>(new Set());
  const spawnClearTimerRef = useRef<number | null>(null);

  function emitConstellationSignal(kind: ConstellationSignal["kind"]) {
    setConstellationSignal((current) => ({ kind, key: current.key + 1 }));
  }

  async function loadFriends() {
    if (!user) {
      setFriends([]);
      return;
    }

    setLoadingFriends(true);

    try {
      const { data: friendshipRows, error: friendshipError } = await supabase
        .from("friendships")
        .select("id, status, requester_id, addressee_id")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
      if (friendshipError) throw friendshipError;

      const rows = friendshipRows ?? [];
      const otherIds = Array.from(
        new Set(
          rows.map((friendship) =>
            friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id,
          ),
        ),
      );

      let profilesById = new Map<string, ProfileSummary>();
      if (otherIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", otherIds);
        if (profileError) throw profileError;

        profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      }

      setFriends(
        rows.map((friendship) => {
          const otherUserId =
            friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id;
          return {
            ...friendship,
            status: friendship.status as FriendshipRow["status"],
            other: profilesById.get(otherUserId) ?? null,
          };
        }),
      );
    } catch (error) {
      console.error("Failed to load friends", error);
      toast.error("Couldn't load friends right now.");
      setFriends([]);
    } finally {
      setLoadingFriends(false);
    }
  }

  useEffect(() => {
    void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function search() {
    if (!user) return;

    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    setSearching(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .ilike("username", `%${trimmedQuery}%`)
        .neq("id", user.id)
        .limit(10);

      if (error) throw error;
      setResults(data ?? []);
    } catch (error) {
      console.error("Failed to search profiles", error);
      toast.error("Search failed. Try again.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest(otherId: string) {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("friendships")
        .insert({ requester_id: user.id, addressee_id: otherId, status: "pending" });

      if (error) throw error;

      toast.success("Friend request sent");
      emitConstellationSignal("outgoing");
      await loadFriends();
    } catch (error) {
      console.error("Failed to send friend request", error);
      toast.error("Already requested or blocked.");
    }
  }

  async function respond(friendshipId: string, accept: boolean) {
    try {
      if (accept) {
        const { error } = await supabase
          .from("friendships")
          .update({ status: "accepted" })
          .eq("id", friendshipId);
        if (error) throw error;
        toast.success("Friend added");
      } else {
        const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
        if (error) throw error;
      }

      await loadFriends();
    } catch (error) {
      console.error("Failed to update friendship", error);
      toast.error("Couldn't update this request.");
    }
  }

  async function openDM(otherId: string) {
    if (!user) return;

    try {
      const conversationId = await findOrCreateDM(user.id, otherId);
      router.navigate({ to: "/chat/$id", params: { id: conversationId } });
    } catch (error) {
      console.error("Failed to open DM", error);
      toast.error(error instanceof Error ? error.message : "Failed to open chat.");
    }
  }

  const incoming = useMemo(
    () =>
      friends.filter(
        (friendship) => friendship.status === "pending" && friendship.addressee_id === user?.id,
      ),
    [friends, user?.id],
  );
  const outgoing = useMemo(
    () =>
      friends.filter(
        (friendship) => friendship.status === "pending" && friendship.requester_id === user?.id,
      ),
    [friends, user?.id],
  );
  const accepted = useMemo(
    () => friends.filter((friendship) => friendship.status === "accepted"),
    [friends],
  );
  const acceptedFriends = useMemo(
    () => accepted.filter((friendship) => Boolean(friendship.other)),
    [accepted],
  );
  const acceptedFriendIdsSignature = useMemo(
    () =>
      acceptedFriends
        .map((friendship) => friendship.other!.id)
        .sort()
        .join(","),
    [acceptedFriends],
  );

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setFriendMetricsById({});
      return;
    }
    let cancelled = false;

    async function loadFriendMetrics() {
      try {
        const conversations = await listConversations(userId);
        if (cancelled) return;

        const dmRows = conversations
          .filter((conversation) => conversation.type === "dm")
          .map((conversation) => {
            const otherMember = conversation.members.find((member) => member.user_id !== userId);
            if (!otherMember) return null;
            return {
              friendId: otherMember.user_id,
              conversationId: conversation.id,
              lastMessageAt: conversation.last_message?.created_at ?? conversation.updated_at,
            };
          })
          .filter((row): row is { friendId: string; conversationId: string; lastMessageAt: string } =>
            Boolean(row),
          );

        const countsByConversation = await countMessagesByConversationIds(
          dmRows.map((row) => row.conversationId),
        );
        if (cancelled) return;

        const nextMetrics: Record<string, FriendInteractionMetric> = {};
        for (const row of dmRows) {
          const previous = nextMetrics[row.friendId];
          if (
            previous &&
            previous.lastMessageAt &&
            new Date(previous.lastMessageAt).getTime() > new Date(row.lastMessageAt).getTime()
          ) {
            continue;
          }

          nextMetrics[row.friendId] = {
            conversationId: row.conversationId,
            totalMessages: countsByConversation[row.conversationId] ?? previous?.totalMessages ?? 0,
            lastMessageAt: row.lastMessageAt,
          };
        }

        for (const friendship of acceptedFriends) {
          const friendId = friendship.other?.id;
          if (!friendId || nextMetrics[friendId]) continue;
          nextMetrics[friendId] = {
            conversationId: null,
            totalMessages: 0,
            lastMessageAt: null,
          };
        }

        setFriendMetricsById(nextMetrics);
      } catch (error) {
        console.error("Failed to load social graph metrics", error);
        if (!cancelled) {
          const fallbackMetrics: Record<string, FriendInteractionMetric> = {};
          for (const friendship of acceptedFriends) {
            const friendId = friendship.other?.id;
            if (!friendId) continue;
            fallbackMetrics[friendId] = {
              conversationId: null,
              totalMessages: 0,
              lastMessageAt: null,
            };
          }
          setFriendMetricsById(fallbackMetrics);
        }
      }
    }

    void loadFriendMetrics();

    return () => {
      cancelled = true;
    };
  }, [acceptedFriendIdsSignature, acceptedFriends, user?.id]);

  const dmConversationToFriendId = useMemo(() => {
    const pairs = Object.entries(friendMetricsById)
      .filter(([, metric]) => Boolean(metric.conversationId))
      .map(([friendId, metric]) => [metric.conversationId!, friendId]);
    return Object.fromEntries(pairs) as Record<string, string>;
  }, [friendMetricsById]);

  useEffect(() => {
    if (!user?.id) return;
    if (Object.keys(dmConversationToFriendId).length === 0) return;

    const channel = supabase
      .channel(`friends-graph:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const inserted = payload.new as {
          conversation_id: string;
          created_at: string;
          sender_id: string;
        };
        const friendId = dmConversationToFriendId[inserted.conversation_id];
        if (!friendId) return;

        setFriendMetricsById((current) => {
          const previous = current[friendId] ?? {
            conversationId: inserted.conversation_id,
            totalMessages: 0,
            lastMessageAt: null,
          };
          return {
            ...current,
            [friendId]: {
              conversationId: inserted.conversation_id,
              totalMessages: previous.totalMessages + 1,
              lastMessageAt: inserted.created_at,
            },
          };
        });

        emitConstellationSignal(inserted.sender_id === user.id ? "outgoing" : "incoming");
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dmConversationToFriendId, user?.id]);

  useEffect(() => {
    const currentAcceptedIds = new Set(acceptedFriends.map((friendship) => friendship.other!.id));
    const previouslyAcceptedIds = acceptedSnapshotRef.current;
    const newlyAcceptedIds = Array.from(currentAcceptedIds).filter((id) => !previouslyAcceptedIds.has(id));

    acceptedSnapshotRef.current = currentAcceptedIds;
    if (newlyAcceptedIds.length === 0) return;

    setSpawnedFriendIds((current) => {
      const next = { ...current };
      for (const addedId of newlyAcceptedIds) {
        next[addedId] = true;
      }
      return next;
    });
    emitConstellationSignal("incoming");

    if (spawnClearTimerRef.current) {
      window.clearTimeout(spawnClearTimerRef.current);
    }
    spawnClearTimerRef.current = window.setTimeout(() => {
      setSpawnedFriendIds({});
      spawnClearTimerRef.current = null;
    }, 1450);
  }, [acceptedFriendIdsSignature, acceptedFriends]);

  useEffect(() => {
    return () => {
      if (spawnClearTimerRef.current) {
        window.clearTimeout(spawnClearTimerRef.current);
      }
    };
  }, []);

  const socialConnections = useMemo(() => {
    return acceptedFriends
      .filter((friendship) => Boolean(friendship.other))
      .map((friendship) => {
        const other = friendship.other!;
        const metric = friendMetricsById[other.id];
        return {
          id: other.id,
          name: other.display_name || other.username,
          username: other.username,
          avatarUrl: other.avatar_url,
          totalMessages: metric?.totalMessages ?? 0,
          lastMessageAt: metric?.lastMessageAt ?? null,
          isOnline: isUserOnline(other.id),
          isTyping: false,
        };
      });
  }, [acceptedFriends, friendMetricsById, isUserOnline]);
  const friendsGradient = useGradient("friends", {
    activity: Math.min(
      1,
      socialConnections.filter((connection) => connection.isOnline).length / 8 +
        socialConnections.length / 24,
    ),
  });

  const { nodes: networkNodes, strongestConnectionId } = useSocialGraph({
    connections: socialConnections,
    maxVisibleNodes: 8,
  });

  function highlightFriendNode(friendId: string | null) {
    if (!friendId) return;
    setSelectedNetworkFriendId(friendId);
    emitConstellationSignal("highlight");
  }

  function onNetworkNodePress(node: SocialGraphNode) {
    if (node.kind === "cluster") {
      toast.message(`${node.overflowCount ?? 0} more connections in your network.`);
      emitConstellationSignal("focus");
      return;
    }

    if (node.kind !== "friend" || !node.id) return;

    if (selectedNetworkFriendId === node.id) {
      void openDM(node.id);
      return;
    }

    highlightFriendNode(node.id);
  }

  const selectedPreview = useMemo(() => {
    if (!selectedNetworkFriendId) return null;
    const selected = acceptedFriends.find((friendship) => friendship.other?.id === selectedNetworkFriendId);
    if (!selected?.other) return null;

    const lastInteractionAt = friendMetricsById[selected.other.id]?.lastMessageAt ?? null;
    return {
      id: selected.other.id,
      name: selected.other.display_name || selected.other.username,
      username: selected.other.username,
      avatarUrl: selected.other.avatar_url,
      online: isUserOnline(selected.other.id),
      lastInteraction: lastInteractionAt
        ? `Last chat ${formatDistanceToNowStrict(new Date(lastInteractionAt))} ago`
        : "No recent chat",
    };
  }, [acceptedFriends, friendMetricsById, isUserOnline, selectedNetworkFriendId]);
  const networkDefocused = searching || query.trim().length > 0;

  useEffect(() => {
    emitConstellationSignal("focus");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedNetworkFriendId) return;
    const stillExists = networkNodes.some(
      (entry) => entry.kind === "friend" && entry.id === selectedNetworkFriendId,
    );
    if (!stillExists) {
      setSelectedNetworkFriendId(null);
    }
  }, [networkNodes, selectedNetworkFriendId]);

  return (
    <div
      className="screen-theme-friends utility-shell-bg screen-enter immersive-root dynamic-gradient-transition flex h-app overflow-hidden"
      style={friendsGradient.style}
    >
      <div className="hidden md:block">
        <ChatSidebar />
      </div>

      <main className="safe-inset mobile-page-gutter flex-1 overflow-y-auto pb-28 md:pb-0">
        <div className="mx-auto max-w-2xl py-4 md:px-8 md:py-10">
          <p className="lux-kicker">Void Network</p>
          <h1 className="lux-title mb-1 mt-2 text-[1.95rem]">Friends</h1>
          <p className="mb-7 text-sm text-muted-foreground">
            Add friends by username. No phone needed.
          </p>

          <div
            className={`section-blend mb-7 rounded-[24px] p-4 ${
              networkDefocused ? "friends-search-active" : ""
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setQuery(nextValue);
                    if (!nextValue.trim()) setResults([]);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void search();
                  }}
                  placeholder="Search by username"
                  className="w-full rounded-xl border border-white/12 bg-black/20 py-2.5 pl-9 pr-3 text-sm outline-none ring-ring focus:ring-2"
                />
              </div>
              <button
                onClick={() => void search()}
                disabled={searching}
                className="premium-elevated quiet-hover min-h-12 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 sm:min-h-0"
              >
                {searching ? "..." : "Search"}
              </button>
            </div>

            {results.length > 0 && (
              <ul className="mt-4 space-y-2">
                {results.map((profile) => {
                  const existingFriendship = friends.find(
                    (friendship) => friendship.other?.id === profile.id,
                  );

                  return (
                    <li
                      key={profile.id}
                      className="flat-section quiet-hover flex items-center gap-3 rounded-xl p-3"
                    >
                      <Avatar
                        name={profile.display_name || profile.username}
                        url={profile.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.display_name || profile.username}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          @{profile.username}
                        </p>
                      </div>

                      {!existingFriendship ? (
                        <button
                          onClick={() => void sendRequest(profile.id)}
                          className="premium-elevated quiet-hover min-h-10 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          aria-label={`Add ${profile.username}`}
                        >
                          <UserPlus className="inline h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="text-xs capitalize text-muted-foreground">
                          {existingFriendship.status}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <FriendsNetworkHub
            totalFriends={accepted.length}
            selectedFriendId={selectedNetworkFriendId}
            strongestFriendId={strongestConnectionId}
            signal={constellationSignal}
            nodes={networkNodes}
            spawnedFriendIds={spawnedFriendIds}
            defocused={networkDefocused}
            preview={selectedPreview}
            onNodePress={onNetworkNodePress}
            onOpenFriend={(friendId) => void openDM(friendId)}
          />

          {incoming.length > 0 && (
            <Section title={`Requests (${incoming.length})`}>
              {incoming.map((friendship) => (
                <li
                  key={friendship.id}
                  className="surface-highlight quiet-hover flex items-center gap-3 rounded-xl p-3"
                >
                  <Avatar
                    name={friendship.other?.display_name || friendship.other?.username || "Unknown"}
                    url={friendship.other?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {friendship.other?.display_name || friendship.other?.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">wants to be friends</p>
                  </div>
                  <button
                    onClick={() => void respond(friendship.id, true)}
                    className="min-h-10 min-w-10 rounded-full bg-success/20 p-2 text-success premium-elevated quiet-hover hover:bg-success/30"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void respond(friendship.id, false)}
                    className="min-h-10 min-w-10 rounded-full bg-destructive/20 p-2 text-destructive premium-elevated quiet-hover hover:bg-destructive/30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </Section>
          )}

          <Section title={`Friends (${accepted.length})`}>
            {accepted.length === 0 ? (
              <li className="flat-section rounded-lg p-4 text-center text-sm text-muted-foreground">
                {loadingFriends ? "Loading friends..." : "No friends yet. Search above to add one."}
              </li>
            ) : (
              accepted.map((friendship) => (
                <li
                  key={friendship.id}
                  onClick={() => highlightFriendNode(friendship.other?.id ?? null)}
                  className={`flat-section quiet-hover flex cursor-pointer items-center gap-3 rounded-xl p-3 ${
                    selectedNetworkFriendId === friendship.other?.id ? "friends-list-selected" : ""
                  }`}
                >
                  <Avatar
                    name={friendship.other?.display_name || friendship.other?.username || "Unknown"}
                    url={friendship.other?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {friendship.other?.display_name || friendship.other?.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      @{friendship.other?.username}
                    </p>
                  </div>
                  {friendship.other && (
                    <button
                      onClick={() => void openDM(friendship.other!.id)}
                      className="premium-elevated quiet-hover min-h-10 min-w-10 rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))
            )}
          </Section>

          {outgoing.length > 0 && (
            <Section title={`Sent (${outgoing.length})`}>
              {outgoing.map((friendship) => (
                <li
                  key={friendship.id}
                  className="flat-section quiet-hover flex items-center gap-3 rounded-xl p-3"
                >
                  <Avatar
                    name={friendship.other?.display_name || friendship.other?.username || "Unknown"}
                    url={friendship.other?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {friendship.other?.display_name || friendship.other?.username}
                    </p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                  <button
                    onClick={() => void respond(friendship.id, false)}
                    className="interactive-surface min-h-10 min-w-10 rounded-full p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </Section>
          )}
        </div>
      </main>

      <MobileDock active="friends" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-white/44">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
