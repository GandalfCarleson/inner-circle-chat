import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, MessageCircle, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { findOrCreateDM } from "@/lib/messaging";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [{ title: "Friends - Halo" }],
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

function FriendsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSummary[]>([]);
  const [friends, setFriends] = useState<FriendshipRow[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [searching, setSearching] = useState(false);

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
        new Set(rows.map((friendship) => (friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id))),
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
          const otherUserId = friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id;
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
      await loadFriends();
    } catch (error) {
      console.error("Failed to send friend request", error);
      toast.error("Already requested or blocked.");
    }
  }

  async function respond(friendshipId: string, accept: boolean) {
    try {
      if (accept) {
        const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
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

  const incoming = friends.filter((friendship) => friendship.status === "pending" && friendship.addressee_id === user?.id);
  const outgoing = friends.filter((friendship) => friendship.status === "pending" && friendship.requester_id === user?.id);
  const accepted = friends.filter((friendship) => friendship.status === "accepted");

  return (
    <div className="flex h-app overflow-hidden bg-background">
      <div className="hidden md:block">
        <ChatSidebar />
      </div>

      <main className="safe-inset mobile-page-gutter flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl py-4 md:px-8 md:py-10">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Friends</h1>
          <p className="mb-6 text-sm text-muted-foreground">Add friends by username. No phone needed.</p>

          <div className="mb-6 rounded-2xl border border-border bg-card p-4">
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
                  className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none ring-ring focus:ring-2"
                />
              </div>
              <button
                onClick={() => void search()}
                disabled={searching}
                className="min-h-12 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 sm:min-h-0"
              >
                {searching ? "..." : "Search"}
              </button>
            </div>

            {results.length > 0 && (
              <ul className="mt-4 space-y-2">
                {results.map((profile) => {
                  const existingFriendship = friends.find((friendship) => friendship.other?.id === profile.id);

                  return (
                    <li key={profile.id} className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
                      <Avatar
                        name={profile.display_name || profile.username}
                        url={profile.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{profile.display_name || profile.username}</p>
                        <p className="truncate text-xs text-muted-foreground">@{profile.username}</p>
                      </div>

                      {!existingFriendship ? (
                        <button
                          onClick={() => void sendRequest(profile.id)}
                          className="min-h-10 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          aria-label={`Add ${profile.username}`}
                        >
                          <UserPlus className="inline h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="text-xs capitalize text-muted-foreground">{existingFriendship.status}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {incoming.length > 0 && (
            <Section title={`Requests (${incoming.length})`}>
              {incoming.map((friendship) => (
                <li key={friendship.id} className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
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
                    className="min-h-10 min-w-10 rounded-full bg-success/20 p-2 text-success hover:bg-success/30"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void respond(friendship.id, false)}
                    className="min-h-10 min-w-10 rounded-full bg-destructive/20 p-2 text-destructive hover:bg-destructive/30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </Section>
          )}

          <Section title={`Friends (${accepted.length})`}>
            {accepted.length === 0 ? (
              <li className="rounded-lg bg-secondary/30 p-4 text-center text-sm text-muted-foreground">
                {loadingFriends ? "Loading friends..." : "No friends yet. Search above to add one."}
              </li>
            ) : (
              accepted.map((friendship) => (
                <li key={friendship.id} className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
                  <Avatar
                    name={friendship.other?.display_name || friendship.other?.username || "Unknown"}
                    url={friendship.other?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {friendship.other?.display_name || friendship.other?.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">@{friendship.other?.username}</p>
                  </div>
                  {friendship.other && (
                    <button
                      onClick={() => void openDM(friendship.other!.id)}
                      className="min-h-10 min-w-10 rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
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
                <li key={friendship.id} className="flex items-center gap-3 rounded-xl bg-secondary/30 p-3">
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
                    className="min-h-10 min-w-10 rounded-full p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </Section>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}
