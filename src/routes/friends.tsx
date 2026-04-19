import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { findOrCreateDM } from "@/lib/messaging";
import { Search, UserPlus, Check, X, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [{ title: "Friends — Halo" }],
  }),
  component: FriendsPage,
});

interface FriendRow {
  id: string;
  status: "pending" | "accepted" | "blocked";
  requester_id: string;
  addressee_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  other: any;
}

function FriendsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [searching, setSearching] = useState(false);

  async function loadFriends() {
    if (!user) return;
    const { data } = await supabase
      .from("friendships")
      .select("id, status, requester_id, addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    if (!data) return;
    const otherIds = data.map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", otherIds);
    setFriends(
      data.map((f) => ({
        ...f,
        status: f.status as FriendRow["status"],
        other: profs?.find((p) => p.id === (f.requester_id === user.id ? f.addressee_id : f.requester_id)),
      })),
    );
  }

  useEffect(() => {
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function search() {
    if (!query.trim() || !user) return;
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .ilike("username", `%${query.trim().toLowerCase()}%`)
      .neq("id", user.id)
      .limit(10);
    setResults(data ?? []);
    setSearching(false);
  }

  async function sendRequest(otherId: string) {
    if (!user) return;
    const { error } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: otherId, status: "pending" });
    if (error) toast.error("Already requested or blocked.");
    else {
      toast.success("Friend request sent");
      loadFriends();
    }
  }

  async function respond(id: string, accept: boolean) {
    if (accept) {
      await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
      toast.success("Friend added");
    } else {
      await supabase.from("friendships").delete().eq("id", id);
    }
    loadFriends();
  }

  async function openDM(otherId: string) {
    if (!user) return;
    try {
      const cid = await findOrCreateDM(user.id, otherId);
      router.navigate({ to: "/chat/$id", params: { id: cid } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const incoming = friends.filter((f) => f.status === "pending" && f.addressee_id === user?.id);
  const outgoing = friends.filter((f) => f.status === "pending" && f.requester_id === user?.id);
  const accepted = friends.filter((f) => f.status === "accepted");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:block">
        <ChatSidebar />
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Friends</h1>
          <p className="mb-6 text-sm text-muted-foreground">Add friends by username — no phone needed.</p>

          {/* Search */}
          <div className="mb-6 rounded-2xl border border-border bg-card p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="Search by username"
                  className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none ring-ring focus:ring-2"
                />
              </div>
              <button
                onClick={search}
                disabled={searching}
                className="rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {searching ? "…" : "Search"}
              </button>
            </div>
            {results.length > 0 && (
              <ul className="mt-4 space-y-2">
                {results.map((p) => {
                  const f = friends.find((x) => x.other?.id === p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
                        {(p.display_name || p.username).slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.display_name || p.username}</p>
                        <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                      </div>
                      {!f ? (
                        <button
                          onClick={() => sendRequest(p.id)}
                          className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <UserPlus className="inline h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{f.status}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {incoming.length > 0 && (
            <Section title={`Requests (${incoming.length})`}>
              {incoming.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
                  <Avatar text={f.other?.display_name || f.other?.username || "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.other?.display_name || f.other?.username}</p>
                    <p className="truncate text-xs text-muted-foreground">wants to be friends</p>
                  </div>
                  <button
                    onClick={() => respond(f.id, true)}
                    className="rounded-full bg-success/20 p-2 text-success hover:bg-success/30"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => respond(f.id, false)}
                    className="rounded-full bg-destructive/20 p-2 text-destructive hover:bg-destructive/30"
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
                No friends yet — search above to add one.
              </li>
            ) : (
              accepted.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
                  <Avatar text={f.other?.display_name || f.other?.username || "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.other?.display_name || f.other?.username}</p>
                    <p className="truncate text-xs text-muted-foreground">@{f.other?.username}</p>
                  </div>
                  <button
                    onClick={() => openDM(f.other.id)}
                    className="rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </li>
              ))
            )}
          </Section>

          {outgoing.length > 0 && (
            <Section title={`Sent (${outgoing.length})`}>
              {outgoing.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-lg bg-secondary/30 p-2.5">
                  <Avatar text={f.other?.display_name || f.other?.username || "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.other?.display_name || f.other?.username}</p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                  <button
                    onClick={() => respond(f.id, false)}
                    className="rounded-full p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
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

function Avatar({ text }: { text: string }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
      {text.slice(0, 1).toUpperCase()}
    </div>
  );
}
