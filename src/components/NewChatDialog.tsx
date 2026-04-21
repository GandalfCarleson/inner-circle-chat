import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Loader2, MessageCircleMore, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createGroup, findOrCreateDM } from "@/lib/messaging";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FriendOption {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

type ComposerMode = "direct" | "group";

export function NewChatDialog({ open, onOpenChange }: NewChatDialogProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("direct");
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;

    async function loadAcceptedFriends() {
      setLoadingFriends(true);

      try {
        const { data: friendships, error: friendshipError } = await supabase
          .from("friendships")
          .select("requester_id, addressee_id, status")
          .eq("status", "accepted")
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
        if (friendshipError) throw friendshipError;

        const otherIds = Array.from(
          new Set(
            (friendships ?? []).map((friendship) =>
              friendship.requester_id === user.id
                ? friendship.addressee_id
                : friendship.requester_id,
            ),
          ),
        );

        if (otherIds.length === 0) {
          if (!cancelled) setFriends([]);
          return;
        }

        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", otherIds)
          .order("username", { ascending: true });
        if (profileError) throw profileError;

        if (!cancelled) {
          setFriends((profiles ?? []) as FriendOption[]);
        }
      } catch (error) {
        console.error("Failed to load friends for new chat", error);
        if (!cancelled) {
          setFriends([]);
          toast.error("Couldn't load your friends right now.");
        }
      } finally {
        if (!cancelled) setLoadingFriends(false);
      }
    }

    void loadAcceptedFriends();

    return () => {
      cancelled = true;
    };
  }, [open, user]);

  useEffect(() => {
    if (!open) {
      setMode("direct");
      setQuery("");
      setGroupName("");
      setSelectedFriendIds([]);
    }
  }, [open]);

  const filteredFriends = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return friends;

    return friends.filter((friend) => {
      const displayName = (friend.display_name || "").toLowerCase();
      return friend.username.toLowerCase().includes(term) || displayName.includes(term);
    });
  }, [friends, query]);

  const selectedFriends = useMemo(
    () =>
      selectedFriendIds
        .map((id) => friends.find((friend) => friend.id === id))
        .filter(Boolean) as FriendOption[],
    [friends, selectedFriendIds],
  );

  function toggleFriendSelection(friendId: string) {
    setSelectedFriendIds((current) =>
      current.includes(friendId) ? current.filter((id) => id !== friendId) : [...current, friendId],
    );
  }

  async function handleSubmit() {
    if (!user || submitting) return;

    try {
      setSubmitting(true);

      if (mode === "direct") {
        const targetId = selectedFriendIds[0];
        if (!targetId) {
          toast.error("Choose one friend to start a chat.");
          return;
        }

        const conversationId = await findOrCreateDM(user.id, targetId);
        onOpenChange(false);
        router.navigate({ to: "/chat/$id", params: { id: conversationId } });
        return;
      }

      const trimmedName = groupName.trim();
      if (!trimmedName) {
        toast.error("Give the group a name.");
        return;
      }
      if (selectedFriendIds.length < 2) {
        toast.error("Choose at least two friends for a group.");
        return;
      }

      const conversationId = await createGroup(user.id, trimmedName, selectedFriendIds);
      onOpenChange(false);
      router.navigate({ to: "/chat/$id", params: { id: conversationId } });
    } catch (error) {
      console.error("Failed to create conversation", error);
      toast.error(error instanceof Error ? error.message : "Couldn't create the conversation.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    mode === "direct"
      ? selectedFriendIds.length === 1
      : groupName.trim().length > 0 && selectedFriendIds.length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="premium-panel shell-noise max-w-2xl border-white/14 bg-[rgba(7,11,19,0.97)] p-0 text-foreground shadow-[0_34px_88px_rgba(0,0,0,0.54)]">
        <DialogHeader className="border-b subtle-divider px-6 pb-5 pt-6 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="lux-kicker">Void</p>
              <DialogTitle className="mt-2 text-[1.5rem] font-medium tracking-[-0.03em] text-foreground">
                New conversation
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Start a direct message or create a private group from the people already in your
                circle.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 pt-5">
          <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMode("direct")}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                  mode === "direct"
                    ? "conversation-selected"
                    : "interactive-surface border-white/10 hover:border-white/16"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="glass-dock flex h-10 w-10 items-center justify-center rounded-2xl text-white/80">
                    <MessageCircleMore className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Direct chat</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pick one friend and jump in.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("group")}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                  mode === "group"
                    ? "conversation-selected"
                    : "interactive-surface border-white/10 hover:border-white/16"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="glass-dock flex h-10 w-10 items-center justify-center rounded-2xl text-white/80">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">New group</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Name it and choose multiple people.
                    </p>
                  </div>
                </div>
              </button>

              {mode === "group" && (
                <div className="glass-dock rounded-[22px] p-3">
                  <label className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Group name
                  </label>
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder="Inner circle"
                    className="w-full rounded-2xl border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground outline-none ring-ring focus:ring-2"
                  />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Group avatars can be added later if you decide to support them.
                  </p>
                </div>
              )}
            </div>

            <div className="glass-dock min-w-0 rounded-[26px]">
              <div className="border-b subtle-divider px-4 py-4">
                <div className="glass-dock flex items-center gap-3 rounded-[20px] px-4 py-3">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search friends"
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              {selectedFriends.length > 0 && (
                <div className="border-b subtle-divider px-4 py-4">
                  <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-white/38">
                    Selected
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedFriends.map((friend) => (
                      <button
                        key={friend.id}
                        type="button"
                        onClick={() => toggleFriendSelection(friend.id)}
                        className="interactive-surface inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-foreground"
                      >
                        <Avatar
                          name={friend.display_name || friend.username}
                          url={friend.avatar_url}
                          size="sm"
                          className="h-6 w-6 text-[9px]"
                        />
                        <span>{friend.display_name || friend.username}</span>
                        <X className="h-3.5 w-3.5 text-white/45" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <ScrollArea className="h-[22rem]">
                <div className="p-3">
                  {loadingFriends ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading friends
                    </div>
                  ) : filteredFriends.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center px-6 text-center">
                      <div className="glass-dock flex h-12 w-12 items-center justify-center rounded-full text-white/70">
                        <Users className="h-5 w-5" />
                      </div>
                      <p className="mt-4 text-sm font-medium text-foreground">
                        {friends.length === 0 ? "No friends available yet" : "No matching friends"}
                      </p>
                      <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                        {friends.length === 0
                          ? "Add a few friends first, then come back to start a direct message or group."
                          : "Try a different username or display name."}
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {filteredFriends.map((friend) => {
                        const selected = selectedFriendIds.includes(friend.id);
                        const directDisabled =
                          mode === "direct" && selectedFriendIds.length === 1 && !selected;

                        return (
                          <li key={friend.id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (mode === "direct") {
                                  setSelectedFriendIds(selected ? [] : [friend.id]);
                                  return;
                                }
                                toggleFriendSelection(friend.id);
                              }}
                              disabled={directDisabled}
                              className={`flex w-full items-center gap-3 rounded-[22px] border px-3 py-3 text-left transition ${
                                selected
                                  ? "conversation-selected"
                                  : "interactive-surface border-transparent hover:border-white/12"
                              } disabled:cursor-not-allowed disabled:opacity-45`}
                            >
                              <Avatar
                                name={friend.display_name || friend.username}
                                url={friend.avatar_url}
                                size="md"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {friend.display_name || friend.username}
                                </p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  @{friend.username}
                                </p>
                              </div>
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  selected ? "bg-primary" : "bg-white/12"
                                }`}
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 border-t subtle-divider pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {mode === "direct"
                ? "Choose one friend to open or continue a private chat."
                : `${selectedFriendIds.length} member${selectedFriendIds.length === 1 ? "" : "s"} selected`}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="interactive-surface rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || submitting || loadingFriends || friends.length === 0}
                className="premium-elevated inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === "direct" ? "Opening..." : "Creating..."}
                  </>
                ) : mode === "direct" ? (
                  "Open chat"
                ) : (
                  "Create group"
                )}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
