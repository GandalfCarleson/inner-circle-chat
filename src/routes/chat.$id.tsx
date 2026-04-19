import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  decryptMessageText,
  downloadAndDecryptMedia,
  sendMessage,
} from "@/lib/messaging";
import {
  ArrowLeft,
  Send,
  Image as ImageIcon,
  Mic,
  Smile,
  X,
  Reply,
  Timer,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/chat/$id")({
  head: () => ({
    meta: [{ title: "Chat — Halo" }],
  }),
  component: ChatPage,
});

interface MemberInfo {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  public_key: string | null;
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

const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢"];

function ChatPage() {
  const { id: convId } = useParams({ from: "/chat/$id" });
  const { user, profile } = useAuth();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [convMeta, setConvMeta] = useState<{ name: string | null; type: string; disappearing_seconds: number | null } | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [reactions, setReactions] = useState<Record<string, { emoji: string; user_id: string }[]>>({});
  const [text, setText] = useState("");
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  const [recording, setRecording] = useState(false);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load conversation + members
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: c } = await supabase
        .from("conversations")
        .select("name, type, disappearing_seconds")
        .eq("id", convId)
        .maybeSingle();
      if (cancelled) return;
      if (c) {
        setConvMeta(c);
        setDisappearing(c.disappearing_seconds);
      }

      const { data: m } = await supabase
        .from("conversation_members")
        .select("user_id, profiles!inner(username, display_name, avatar_url, public_key)")
        .eq("conversation_id", convId);
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mems: MemberInfo[] = (m ?? []).map((r: any) => ({
        user_id: r.user_id,
        username: r.profiles.username,
        display_name: r.profiles.display_name,
        avatar_url: r.profiles.avatar_url,
        public_key: r.profiles.public_key,
      }));
      setMembers(mems);
    })();
    return () => {
      cancelled = true;
    };
  }, [convId, user]);

  // Load messages
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      setMessages((data ?? []) as MessageRow[]);

      const { data: rx } = await supabase
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", (data ?? []).map((d) => d.id));
      if (cancelled) return;
      const map: Record<string, { emoji: string; user_id: string }[]> = {};
      for (const r of rx ?? []) {
        (map[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id });
      }
      setReactions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [convId, user]);

  // Realtime subscriptions
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`chat:${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as MessageRow]),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => setMessages((prev) => prev.filter((m) => m.id !== (payload.old as MessageRow).id)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        async () => {
          const ids = messages.map((m) => m.id);
          if (ids.length === 0) return;
          const { data: rx } = await supabase
            .from("message_reactions")
            .select("message_id, user_id, emoji")
            .in("message_id", ids);
          const map: Record<string, { emoji: string; user_id: string }[]> = {};
          for (const r of rx ?? []) (map[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id });
          setReactions(map);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [convId, user, messages]);

  // Decrypt incoming messages
  useEffect(() => {
    if (!user || !profile?.public_key) return;
    const myPub = profile.public_key;
    const myId = user.id;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = { ...decrypted };
      const mediaNext: Record<string, string> = { ...mediaUrls };
      for (const m of messages) {
        if (m.type === "text" && next[m.id] === undefined) {
          const t = await decryptMessageText(m, myId, myPub);
          next[m.id] = t ?? "🔒 Unable to decrypt";
        } else if ((m.type === "image" || m.type === "voice") && m.media_path && !mediaNext[m.id]) {
          const mime = m.type === "image" ? "image/jpeg" : "audio/webm";
          const blob = await downloadAndDecryptMedia(m.media_path, m, myId, myPub, mime);
          if (blob) mediaNext[m.id] = URL.createObjectURL(blob);
        }
      }
      if (!cancelled) {
        setDecrypted(next);
        setMediaUrls(mediaNext);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, user, profile?.public_key]);

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Auto-delete expired messages periodically (client-side cleanup; server still has them until purged)
  useEffect(() => {
    const t = setInterval(() => {
      setMessages((prev) => prev.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > Date.now()));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const otherMembers = useMemo(
    () => members.filter((m) => m.user_id !== user?.id),
    [members, user?.id],
  );
  const title = convMeta?.name || otherMembers.map((m) => m.display_name || m.username).join(", ") || "Chat";

  const recipients = useMemo(
    () => members.filter((m) => m.public_key).map((m) => ({ userId: m.user_id, publicKey: m.public_key as string })),
    [members],
  );

  async function handleSendText() {
    if (!text.trim() || !user) return;
    const body = text.trim();
    setText("");
    try {
      await sendMessage({
        conversationId: convId,
        senderId: user.id,
        recipients,
        type: "text",
        text: body,
        replyTo: replyTarget?.id ?? null,
        expiresInSec: disappearing,
      });
      setReplyTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
      setText(body);
    }
  }

  async function handleImage(file: File) {
    if (!user) return;
    try {
      await sendMessage({
        conversationId: convId,
        senderId: user.id,
        recipients,
        type: "image",
        blob: file,
        replyTo: replyTarget?.id ?? null,
        expiresInSec: disappearing,
      });
      setReplyTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!user) return;
        try {
          await sendMessage({
            conversationId: convId,
            senderId: user.id,
            recipients,
            type: "voice",
            blob,
            expiresInSec: disappearing,
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Send failed");
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!user) return;
    const existing = reactions[messageId]?.find((r) => r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji);
    } else {
      await supabase.from("message_reactions").insert({ message_id: messageId, user_id: user.id, emoji });
    }
    setShowEmojiFor(null);
  }

  async function deleteMessage(id: string) {
    await supabase.from("messages").delete().eq("id", id);
  }

  async function setDisappearingMode(secs: number | null) {
    setDisappearing(secs);
    await supabase.from("conversations").update({ disappearing_seconds: secs }).eq("id", convId);
    toast.success(secs ? `Messages will vanish after ${secs}s` : "Disappearing off");
  }

  function senderOf(uid: string) {
    return members.find((m) => m.user_id === uid);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:block">
        <ChatSidebar activeId={convId} />
      </div>

      <main className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-border bg-card/40 px-3 py-3 backdrop-blur md:px-5">
          <Link to="/" className="rounded-full p-1.5 hover:bg-secondary md:hidden" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
            {title.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {convMeta?.type === "group" ? `${members.length} members` : "End-to-end encrypted"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDisappearingMode(disappearing ? null : 60)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
                disappearing ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              title="Disappearing messages"
            >
              <Timer className="h-3.5 w-3.5" />
              {disappearing ? `${disappearing}s` : "Off"}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
            {messages.length === 0 && (
              <div className="mt-20 text-center text-sm text-muted-foreground">
                <p>This is the start of your conversation.</p>
                <p className="mt-1 text-xs">Messages are end-to-end encrypted.</p>
              </div>
            )}
            {messages.map((m, i) => {
              const mine = m.sender_id === user?.id;
              const sender = senderOf(m.sender_id);
              const prev = messages[i - 1];
              const showSender = !mine && convMeta?.type === "group" && (!prev || prev.sender_id !== m.sender_id);
              const replyMsg = m.reply_to ? messages.find((x) => x.id === m.reply_to) : null;
              const myReactions = reactions[m.id] ?? [];

              return (
                <div key={m.id} className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  {showSender && (
                    <span className="mb-0.5 ml-3 text-[10px] font-medium text-muted-foreground">
                      {sender?.display_name || sender?.username}
                    </span>
                  )}
                  <div className={`flex max-w-[85%] items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                    <div className="relative">
                      {replyMsg && (
                        <div className={`mb-1 rounded-lg border-l-2 border-primary bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground ${mine ? "border-r-2 border-l-0" : ""}`}>
                          <p className="font-medium text-foreground/70">
                            {senderOf(replyMsg.sender_id)?.display_name || senderOf(replyMsg.sender_id)?.username}
                          </p>
                          <p className="line-clamp-1">{decrypted[replyMsg.id] || "Media"}</p>
                        </div>
                      )}
                      <div
                        className={`relative rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                          mine
                            ? "bg-bubble-mine text-bubble-mine-foreground"
                            : "bg-bubble-theirs text-bubble-theirs-foreground"
                        }`}
                      >
                        {m.type === "text" && (
                          <p className="whitespace-pre-wrap break-words">
                            {decrypted[m.id] ?? "…"}
                          </p>
                        )}
                        {m.type === "image" && mediaUrls[m.id] && (
                          <img src={mediaUrls[m.id]} alt="Sent" className="max-h-64 rounded-lg" />
                        )}
                        {m.type === "image" && !mediaUrls[m.id] && (
                          <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-black/20 text-xs">Decrypting…</div>
                        )}
                        {m.type === "voice" && mediaUrls[m.id] && (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <audio controls src={mediaUrls[m.id]} className="h-9" />
                        )}
                        {m.type === "voice" && !mediaUrls[m.id] && (
                          <div className="flex h-9 w-40 items-center justify-center text-xs">Decrypting…</div>
                        )}
                        {myReactions.length > 0 && (
                          <div className={`absolute -bottom-2 ${mine ? "left-2" : "right-2"} flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-[11px] shadow-sm`}>
                            {Object.entries(
                              myReactions.reduce<Record<string, number>>((acc, r) => {
                                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                return acc;
                              }, {}),
                            ).map(([emoji, count]) => (
                              <span key={emoji}>
                                {emoji} {count > 1 && count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {showEmojiFor === m.id && (
                        <div className={`absolute z-10 mt-1 flex gap-1 rounded-full border border-border bg-popover p-1 shadow-lg ${mine ? "right-0" : "left-0"}`}>
                          {QUICK_EMOJIS.map((e) => (
                            <button
                              key={e}
                              onClick={() => toggleReaction(m.id, e)}
                              className="rounded-full p-1 text-base transition hover:bg-secondary"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Message actions */}
                    <div className="flex flex-col gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => setShowEmojiFor(showEmojiFor === m.id ? null : m.id)}
                        className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="React"
                      >
                        <Smile className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setReplyTarget(m)}
                        className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Reply"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      {mine && (
                        <button
                          onClick={() => deleteMessage(m.id)}
                          className="rounded-full p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <span className={`mt-1 px-2 text-[10px] text-muted-foreground ${myReactions.length > 0 ? "mt-3" : ""}`}>
                    {format(new Date(m.created_at), "HH:mm")}
                    {m.expires_at && " · ⏱"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reply chip */}
        {replyTarget && (
          <div className="border-t border-border bg-card/50 px-4 py-2">
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              <Reply className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="flex-1 truncate text-xs text-muted-foreground">
                Replying to <span className="font-medium text-foreground">{senderOf(replyTarget.sender_id)?.display_name || senderOf(replyTarget.sender_id)?.username}</span>: {decrypted[replyTarget.id] || "media"}
              </p>
              <button onClick={() => setReplyTarget(null)} className="rounded-full p-1 hover:bg-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border bg-card/30 px-3 py-3 md:px-6">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImage(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full p-2.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Send image"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <div className="flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
                placeholder="Message…"
                rows={1}
                className="max-h-32 w-full resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm outline-none ring-ring focus:ring-2"
              />
            </div>
            {text.trim() ? (
              <button
                onClick={handleSendText}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            ) : (
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={recording ? stopRecording : undefined}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                  recording
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                }`}
                aria-label={recording ? "Recording — release to send" : "Hold to record voice"}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
          </div>
          {recording && (
            <p className="mt-2 text-center text-xs text-destructive">● Recording — release to send</p>
          )}
        </div>
      </main>
    </div>
  );
}
