import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Image as ImageIcon,
  Mic,
  MoreHorizontal,
  Phone,
  Reply,
  Send,
  Smile,
  Timer,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useCallManager } from "@/contexts/CallContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadMedia, getMessageBody, markConversationRead, sendMessage } from "@/lib/messaging";

export const Route = createFileRoute("/chat/$id")({
  head: () => ({
    meta: [{ title: "Chat - Void" }],
  }),
  component: ChatPage,
});

interface MemberInfo {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: "text" | "image" | "voice" | "system";
  ciphertext: string;
  nonce: string;
  recipient_keys: Record<string, string>;
  media_path: string | null;
  reply_to: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ReactionRow {
  emoji: string;
  user_id: string;
}

const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢"];
const IMAGE_ACCEPT_PREFIX = "image/";
const AUDIO_MIME_TYPE = "audio/webm";

// Legacy schema note:
// messages.ciphertext still stores plain text for compatibility with the original schema.
function getMessageText(message: Pick<MessageRow, "ciphertext">) {
  return getMessageBody(message);
}

function buildReactionMap(rows: { message_id: string; user_id: string; emoji: string }[]) {
  return rows.reduce<Record<string, ReactionRow[]>>((acc, row) => {
    (acc[row.message_id] ||= []).push({ emoji: row.emoji, user_id: row.user_id });
    return acc;
  }, {});
}

function scrollToLatest(container: HTMLDivElement | null, behavior: ScrollBehavior = "smooth") {
  if (!container) return;
  container.scrollTo({ top: container.scrollHeight, behavior });
}

async function fetchConversationMembers(conversationId: string): Promise<MemberInfo[]> {
  const { data: members, error: memberError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);
  if (memberError) throw memberError;

  const memberIds = Array.from(new Set((members ?? []).map((member) => member.user_id)));
  if (memberIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", memberIds);
  if (profileError) throw profileError;

  const profileById = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      {
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      },
    ]),
  );

  return (
    (members ?? []).map((member): MemberInfo => {
      const profile = profileById.get(member.user_id);
      return {
        user_id: member.user_id,
        username: profile?.username ?? "unknown",
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      };
    }) ?? []
  );
}

function getChatAvatarUrl(
  conversationType: string | null | undefined,
  conversationName: string | null | undefined,
  otherMembers: MemberInfo[],
) {
  if (conversationType === "group") {
    return null;
  }

  if (conversationName) {
    return otherMembers[0]?.avatar_url ?? null;
  }

  return otherMembers[0]?.avatar_url ?? null;
}

async function fetchConversationMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

async function fetchReactionRows(messageIds: string[]) {
  if (messageIds.length === 0) return {};

  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);

  if (error) throw error;
  return buildReactionMap(data ?? []);
}

function ChatPage() {
  const { id: convId } = useParams({ from: "/chat/$id" });
  const { user } = useAuth();
  const { startOutgoingCall, isBusy } = useCallManager();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [convMeta, setConvMeta] = useState<{
    name: string | null;
    type: string;
    disappearing_seconds: number | null;
  } | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [reactions, setReactions] = useState<Record<string, ReactionRow[]>>({});
  const [text, setText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const replyTarget = useMemo(
    () => messages.find((message) => message.id === replyTargetId) ?? null,
    [messages, replyTargetId],
  );
  const otherMembers = useMemo(() => members.filter((member) => member.user_id !== user?.id), [members, user?.id]);
  const title = convMeta?.name || otherMembers.map((member) => member.display_name || member.username).join(", ") || "Chat";
  const subtitle =
    convMeta?.type === "group"
      ? `${members.length} members`
      : otherMembers[0]
        ? `Private chat with ${otherMembers[0].display_name || otherMembers[0].username}`
        : "Direct conversation";
  const isDirectMessage = convMeta?.type === "dm" && otherMembers.length === 1;
  const directMessageTarget = otherMembers[0] ?? null;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadConversationChrome() {
      try {
        const [{ data: conversation, error: conversationError }, nextMembers, ownMembership] = await Promise.all([
          supabase
            .from("conversations")
            .select("name, type, disappearing_seconds")
            .eq("id", convId)
            .maybeSingle(),
          fetchConversationMembers(convId),
          supabase
            .from("conversation_members")
            .select("last_read_at")
            .eq("conversation_id", convId)
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);

        if (conversationError) throw conversationError;
        if (ownMembership.error) throw ownMembership.error;
        if (cancelled) return;

        setConvMeta(conversation ?? null);
        setDisappearing(conversation?.disappearing_seconds ?? null);
        setMembers(nextMembers);
        setLastReadAt(ownMembership.data?.last_read_at ?? null);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load conversation details", error);
        toast.error("Couldn't load this chat right now.");
        setConvMeta(null);
        setMembers([]);
        setLastReadAt(null);
      }
    }

    loadConversationChrome();

    return () => {
      cancelled = true;
    };
  }, [convId, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadMessages() {
      try {
        const nextMessages = await fetchConversationMessages(convId);
        const nextReactions = await fetchReactionRows(nextMessages.map((message) => message.id));

        if (cancelled) return;
        setMessages(nextMessages);
        setReactions(nextReactions);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load messages", error);
        toast.error("Couldn't load messages right now.");
        setMessages([]);
        setReactions({});
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [convId, user]);

  useEffect(() => {
    if (!user) return;

    async function refreshReactionsForCurrentMessages() {
      try {
        setReactions(await fetchReactionRows(messages.map((message) => message.id)));
      } catch (error) {
        console.error("Failed to refresh reactions", error);
      }
    }

    // Keep the chat screen in sync without forcing full reloads after every insert/update.
    const channel = supabase
      .channel(`chat:${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          setMessages((current) => [...current, payload.new as MessageRow]);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const deletedId = (payload.old as Pick<MessageRow, "id">).id;
          setMessages((current) => current.filter((message) => message.id !== deletedId));
          setMediaUrls((current) => {
            const next = { ...current };
            const staleUrl = next[deletedId];
            if (staleUrl) URL.revokeObjectURL(staleUrl);
            delete next[deletedId];
            return next;
          });
          setShowEmojiFor((current) => (current === deletedId ? null : current));
          setReplyTargetId((current) => (current === deletedId ? null : current));
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        void refreshReactionsForCurrentMessages();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [convId, messages, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadMissingMedia() {
      const pendingMessages = messages.filter(
        (message) =>
          (message.type === "image" || message.type === "voice") &&
          !!message.media_path &&
          !mediaUrls[message.id],
      );

      if (pendingMessages.length === 0) return;

      const loadedEntries = await Promise.all(
        pendingMessages.map(async (message) => {
          const blob = await downloadMedia(message.media_path!);
          return blob ? [message.id, URL.createObjectURL(blob)] : null;
        }),
      );

      if (cancelled) {
        for (const entry of loadedEntries) {
          if (entry) URL.revokeObjectURL(entry[1]);
        }
        return;
      }

      setMediaUrls((current) => {
        const next = { ...current };
        for (const entry of loadedEntries) {
          if (!entry || next[entry[0]]) continue;
          next[entry[0]] = entry[1];
        }
        return next;
      });
    }

    void loadMissingMedia();

    return () => {
      cancelled = true;
    };
  }, [mediaUrls, messages, user]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(mediaUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [mediaUrls]);

  useEffect(() => {
    scrollToLatest(scrollRef.current, "smooth");
  }, [messages.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    function keepComposerVisible() {
      window.setTimeout(() => scrollToLatest(scrollRef.current, "smooth"), 120);
    }

    textarea.addEventListener("focus", keepComposerVisible);
    window.visualViewport?.addEventListener("resize", keepComposerVisible);

    return () => {
      textarea.removeEventListener("focus", keepComposerVisible);
      window.visualViewport?.removeEventListener("resize", keepComposerVisible);
    };
  }, []);

  useEffect(() => {
    // Disappearing messages are enforced by expiry timestamps already stored in the database.
    // This interval only keeps expired rows from lingering in the local view.
    const timer = window.setInterval(() => {
      setMessages((current) =>
        current.filter((message) => !message.expires_at || new Date(message.expires_at).getTime() > Date.now()),
      );
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!user || messages.length === 0) return;

    async function syncReadState() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      try {
        const nextLastReadAt = await markConversationRead(convId, user.id, messages, lastReadAt);
        if (nextLastReadAt && nextLastReadAt !== lastReadAt) {
          setLastReadAt(nextLastReadAt);
        }
      } catch (error) {
        console.error("Failed to mark conversation as read", error);
      }
    }

    void syncReadState();

    function handleVisibilityChange() {
      void syncReadState();
    }

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [convId, lastReadAt, messages, user]);

  function senderOf(userId: string) {
    return members.find((member) => member.user_id === userId);
  }

  function groupedReactions(messageId: string) {
    return Object.entries(
      (reactions[messageId] ?? []).reduce<Record<string, number>>((acc, reaction) => {
        acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
        return acc;
      }, {}),
    );
  }

  async function refreshReactionsAfterMutation(messageId: string) {
    try {
      const nextReactions = await fetchReactionRows([messageId]);
      setReactions((current) => ({
        ...current,
        [messageId]: nextReactions[messageId] ?? [],
      }));
    } catch (error) {
      console.error("Failed to refresh reactions after mutation", error);
    }
  }

  async function handleSendText() {
    if (!user || !text.trim()) return;

    const bodyText = text.trim();
    setText("");

    try {
      await sendMessage({
        conversationId: convId,
        senderId: user.id,
        type: "text",
        text: bodyText,
        replyTo: replyTarget?.id ?? null,
        expiresInSec: disappearing,
      });
      setReplyTargetId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send");
      setText(bodyText);
    }
  }

  async function handleImage(file: File) {
    if (!user) return;

    if (!file.type.startsWith(IMAGE_ACCEPT_PREFIX)) {
      toast.error("Please choose an image file.");
      return;
    }

    try {
      await sendMessage({
        conversationId: convId,
        senderId: user.id,
        type: "image",
        blob: file,
        replyTo: replyTarget?.id ?? null,
        expiresInSec: disappearing,
      });
      setReplyTargetId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function startRecording() {
    if (recording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: AUDIO_MIME_TYPE });

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(chunksRef.current, { type: AUDIO_MIME_TYPE });
        chunksRef.current = [];

        if (!user || audioBlob.size === 0) return;

        try {
          await sendMessage({
            conversationId: convId,
            senderId: user.id,
            type: "voice",
            blob: audioBlob,
            replyTo: replyTarget?.id ?? null,
            expiresInSec: disappearing,
          });
          setReplyTargetId(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Send failed");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      console.error("Microphone access failed", error);
      toast.error("Microphone permission denied");
    }
  }

  function stopRecording() {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return;
    recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!user) return;

    const hasReaction = reactions[messageId]?.some(
      (reaction) => reaction.user_id === user.id && reaction.emoji === emoji,
    );

    try {
      if (hasReaction) {
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", user.id)
          .eq("emoji", emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("message_reactions")
          .insert({ message_id: messageId, user_id: user.id, emoji });
        if (error) throw error;
      }

      setShowEmojiFor(null);
      await refreshReactionsAfterMutation(messageId);
    } catch (error) {
      console.error("Failed to toggle reaction", error);
      toast.error("Couldn't update reaction right now.");
    }
  }

  async function deleteMessage(messageId: string) {
    try {
      const { error } = await supabase.from("messages").delete().eq("id", messageId);
      if (error) throw error;
    } catch (error) {
      console.error("Failed to delete message", error);
      toast.error("Couldn't delete this message.");
    }
  }

  async function setDisappearingMode(seconds: number | null) {
    setDisappearing(seconds);

    try {
      const { error } = await supabase
        .from("conversations")
        .update({ disappearing_seconds: seconds })
        .eq("id", convId);

      if (error) throw error;
      toast.success(seconds ? `Messages will vanish after ${seconds}s` : "Disappearing off");
    } catch (error) {
      console.error("Failed to update disappearing mode", error);
      toast.error("Couldn't update disappearing messages.");
      setDisappearing(convMeta?.disappearing_seconds ?? null);
    }
  }

  async function handleStartCall(type: "audio" | "video") {
    if (!user) return;

    if (!isDirectMessage || !directMessageTarget) {
      toast.error("Calls are available only in direct messages.");
      return;
    }

    try {
      await startOutgoingCall({
        conversationId: convId,
        calleeUserId: directMessageTarget.user_id,
        calleeDisplayName: directMessageTarget.display_name || directMessageTarget.username || "Unknown",
        type,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start call.");
    }
  }

  return (
    <div className="app-shell-bg flex h-app overflow-hidden p-0 md:p-4">
      <div className="hidden md:block md:w-[27rem] md:pr-4">
        <ChatSidebar activeId={convId} />
      </div>

      <main className="premium-panel relative flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-[30px]">
        <header className="safe-top-tight premium-panel-soft sticky top-0 z-20 border-b subtle-divider px-3 py-3 md:px-6 md:py-5">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="interactive-surface inline-flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:hidden"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <Avatar name={title} url={getChatAvatarUrl(convMeta?.type, convMeta?.name, otherMembers)} size="md" />

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-[-0.025em] text-foreground md:text-lg">
                {title}
              </h1>
              <p className="truncate text-xs uppercase tracking-[0.18em] text-white/38 md:text-[11px]">
                {subtitle}
              </p>
            </div>

            {isDirectMessage && (
              <>
                <button
                  onClick={() => void handleStartCall("audio")}
                  disabled={isBusy}
                  className="interactive-surface inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-45 hover:text-foreground md:h-11 md:w-11"
                  aria-label="Start voice call"
                  title="Start voice call"
                >
                  <Phone className="h-4 w-4" />
                </button>

                <button
                  onClick={() => void handleStartCall("video")}
                  disabled={isBusy}
                  className="interactive-surface inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-45 hover:text-foreground md:h-11 md:w-11"
                  aria-label="Start video call"
                  title="Start video call"
                >
                  <Video className="h-4 w-4" />
                </button>
              </>
            )}

            <button
              onClick={() => void setDisappearingMode(disappearing ? null : 60)}
              className={`quiet-hover inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-[11px] font-medium uppercase tracking-[0.18em] md:h-11 md:px-3.5 md:text-xs ${
                disappearing
                  ? "border-white/12 bg-white/[0.06] text-foreground"
                  : "border-white/8 bg-white/[0.02] text-muted-foreground hover:text-foreground"
              }`}
              title="Disappearing messages"
            >
              <Timer className="h-3.5 w-3.5" />
              {disappearing ? `${disappearing}s` : "Off"}
            </button>

            <button className="interactive-surface hidden h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:inline-flex">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="mobile-scroll-padding flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && (
              <div className="premium-panel-soft mx-auto mt-16 max-w-md rounded-[28px] px-7 py-9 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-white/72">
                  <Reply className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-xl font-medium tracking-[-0.03em] text-foreground">
                  Start the conversation
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Send the first message and keep it simple. The room is ready when you are.
                </p>
              </div>
            )}

            {messages.map((message, index) => {
              const mine = message.sender_id === user?.id;
              const sender = senderOf(message.sender_id);
              const previousMessage = messages[index - 1];
              const nextMessage = messages[index + 1];
              const startsGroup = !previousMessage || previousMessage.sender_id !== message.sender_id;
              const endsGroup = !nextMessage || nextMessage.sender_id !== message.sender_id;
              const showSender = !mine && convMeta?.type === "group" && startsGroup;
              const replyMessage = message.reply_to
                ? messages.find((candidate) => candidate.id === message.reply_to) ?? null
                : null;
              const reactionSummary = groupedReactions(message.id);
              const replySender = replyMessage ? senderOf(replyMessage.sender_id) : null;

              return (
                <div
                  key={message.id}
                  className={`group flex flex-col ${mine ? "items-end" : "items-start"} ${
                    startsGroup ? "pt-2" : ""
                  }`}
                >
                  {showSender && (
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <Avatar
                        name={sender?.display_name || sender?.username || "Unknown"}
                        url={sender?.avatar_url}
                        size="sm"
                        className="h-7 w-7 text-[10px]"
                      />
                      <span className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                        {sender?.display_name || sender?.username}
                      </span>
                    </div>
                  )}

                  <div className={`flex max-w-[96%] items-end gap-2 sm:max-w-[92%] md:max-w-[78%] ${mine ? "flex-row-reverse" : ""}`}>
                    <div className="relative">
                      {replyMessage && (
                        <div
                          className={`mb-2 rounded-[18px] border bg-white/[0.035] px-3 py-2 text-[11px] text-muted-foreground ${
                            mine ? "border-white/10" : "border-white/8"
                          }`}
                        >
                          <p className="font-medium text-foreground/72">
                            {replySender?.display_name || replySender?.username || "Unknown"}
                          </p>
                          <p className="mt-1 line-clamp-1">{getMessageText(replyMessage) || "Media"}</p>
                        </div>
                      )}

                      <div
                        className={`relative overflow-hidden rounded-[24px] px-3.5 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.18)] md:rounded-[26px] md:px-4 ${
                          mine
                            ? "bg-bubble-mine text-bubble-mine-foreground"
                            : "border border-white/8 bg-bubble-theirs text-bubble-theirs-foreground"
                        } ${startsGroup ? "" : mine ? "rounded-tr-[18px]" : "rounded-tl-[18px]"} ${
                          endsGroup ? "" : mine ? "rounded-br-[18px]" : "rounded-bl-[18px]"
                        }`}
                      >
                        {message.type === "text" && (
                          <p className="whitespace-pre-wrap break-words text-[14px] leading-6 md:text-[15px]">
                            {getMessageText(message) || "..."}
                          </p>
                        )}

                        {message.type === "image" && mediaUrls[message.id] && (
                          <img src={mediaUrls[message.id]} alt="Sent" className="max-h-[18rem] rounded-[18px] sm:max-h-[22rem]" />
                        )}
                        {message.type === "image" && !mediaUrls[message.id] && (
                          <div className="flex h-36 w-52 items-center justify-center rounded-[18px] bg-black/20 text-xs text-white/60">
                            Loading image
                          </div>
                        )}

                        {message.type === "voice" && mediaUrls[message.id] && (
                          <audio controls src={mediaUrls[message.id]} className="h-10 w-[16rem]" />
                        )}
                        {message.type === "voice" && !mediaUrls[message.id] && (
                          <div className="flex h-10 w-44 items-center justify-center text-xs text-white/60">
                            Loading audio
                          </div>
                        )}

                        {reactionSummary.length > 0 && (
                          <div
                            className={`absolute -bottom-3 flex gap-1 rounded-full border border-white/10 bg-[rgba(16,18,22,0.92)] px-2 py-1 text-[11px] text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.22)] ${
                              mine ? "left-3" : "right-3"
                            }`}
                          >
                            {reactionSummary.map(([emoji, count]) => (
                              <span key={emoji} className="inline-flex items-center gap-1">
                                <span>{emoji}</span>
                                {count > 1 && <span className="text-white/60">{count}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {showEmojiFor === message.id && (
                        <div
                          className={`premium-panel absolute z-10 mt-2 flex gap-1 rounded-full px-2 py-2 ${
                            mine ? "right-0" : "left-0"
                          }`}
                        >
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => void toggleReaction(message.id, emoji)}
                              className="interactive-surface rounded-full px-2 py-1 text-base"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                      <div className="flex flex-col gap-1 opacity-100 transition duration-150 md:opacity-0 md:group-hover:opacity-100">
                        <button
                          onClick={() => setShowEmojiFor(showEmojiFor === message.id ? null : message.id)}
                          className="interactive-surface inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground md:h-9 md:w-9"
                          aria-label="React"
                        >
                        <Smile className="h-3.5 w-3.5" />
                      </button>
                      <button
                          onClick={() => setReplyTargetId(message.id)}
                          className="interactive-surface inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground md:h-9 md:w-9"
                          aria-label="Reply"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      {mine && (
                        <button
                          onClick={() => void deleteMessage(message.id)}
                          className="interactive-surface inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-destructive md:h-9 md:w-9"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <span
                    className={`mt-2 px-2 text-[10px] uppercase tracking-[0.14em] text-white/28 ${
                      reactionSummary.length > 0 ? "mt-5" : ""
                    }`}
                  >
                    {format(new Date(message.created_at), "HH:mm")}
                    {message.expires_at && " · vanishes"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {replyTarget && (
          <div className="border-t subtle-divider bg-white/[0.02] px-3 py-3 md:px-6">
            <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-[22px] premium-panel-soft px-3 py-3">
              <Reply className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/34">
                  Replying to {senderOf(replyTarget.sender_id)?.display_name || senderOf(replyTarget.sender_id)?.username}
                </p>
                <p className="truncate text-sm text-muted-foreground">{getMessageText(replyTarget) || "Media"}</p>
              </div>
              <button
                onClick={() => setReplyTargetId(null)}
                className="interactive-surface inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="mobile-dock-padding border-t subtle-divider bg-white/[0.02] px-3 py-3 md:px-6 md:py-5">
          <div className="mx-auto max-w-3xl">
            <div className="premium-panel flex items-end gap-2 rounded-[28px] px-2.5 py-2.5 md:px-4 md:py-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImage(file);
                  event.target.value = "";
                }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="interactive-surface inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:h-11 md:w-11"
                aria-label="Send image"
              >
                <ImageIcon className="h-4.5 w-4.5" />
              </button>

              <div className="min-w-0 flex-1 rounded-[24px] border border-white/8 bg-black/10 px-3.5 py-2.5 md:px-4">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendText();
                    }
                  }}
                  placeholder="Write something thoughtful..."
                  rows={1}
                  className="max-h-32 w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground md:max-h-40"
                />
              </div>

              {text.trim() ? (
                <button
                  onClick={() => void handleSendText()}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_14px_30px_rgba(0,0,0,0.22)] quiet-hover hover:translate-y-[-1px] hover:opacity-95 md:h-11 md:w-11"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onMouseDown={() => void startRecording()}
                  onMouseUp={stopRecording}
                  onMouseLeave={recording ? stopRecording : undefined}
                  onTouchStart={() => void startRecording()}
                  onTouchEnd={stopRecording}
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl quiet-hover md:h-11 md:w-11 ${
                    recording
                      ? "bg-destructive text-destructive-foreground shadow-[0_16px_30px_rgba(120,24,24,0.24)]"
                      : "interactive-surface text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={recording ? "Recording - release to send" : "Hold to record voice"}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
            </div>

            {recording && (
              <p className="mt-2 text-center text-[11px] uppercase tracking-[0.18em] text-destructive">
                Recording - release to send
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
