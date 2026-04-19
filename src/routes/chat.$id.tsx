import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { downloadMedia, sendMessage } from "@/lib/messaging";
import {
  ArrowLeft,
  Image as ImageIcon,
  Mic,
  MoreHorizontal,
  Reply,
  Send,
  Smile,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/chat/$id")({
  head: () => ({
    meta: [{ title: "Chat - Halo" }],
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

const QUICK_EMOJIS = ["❤️", "😂", "🔥", "👍", "😮", "😢"];

function ChatPage() {
  const { id: convId } = useParams({ from: "/chat/$id" });
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [convMeta, setConvMeta] = useState<{ name: string | null; type: string; disappearing_seconds: number | null } | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        .select("user_id, profiles!inner(username, display_name, avatar_url)")
        .eq("conversation_id", convId);
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mems: MemberInfo[] = (m ?? []).map((r: any) => ({
        user_id: r.user_id,
        username: r.profiles.username,
        display_name: r.profiles.display_name,
        avatar_url: r.profiles.avatar_url,
      }));
      setMembers(mems);
    })();

    return () => {
      cancelled = true;
    };
  }, [convId, user]);

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
      for (const r of rx ?? []) (map[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id });
      setReactions(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [convId, user]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, async () => {
        const ids = messages.map((m) => m.id);
        if (ids.length === 0) return;
        const { data: rx } = await supabase
          .from("message_reactions")
          .select("message_id, user_id, emoji")
          .in("message_id", ids);
        const map: Record<string, { emoji: string; user_id: string }[]> = {};
        for (const r of rx ?? []) (map[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id });
        setReactions(map);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [convId, user, messages]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const mediaNext: Record<string, string> = { ...mediaUrls };
      for (const m of messages) {
        if ((m.type === "image" || m.type === "voice") && m.media_path && !mediaNext[m.id]) {
          const blob = await downloadMedia(m.media_path);
          if (blob) mediaNext[m.id] = URL.createObjectURL(blob);
        }
      }
      if (!cancelled) setMediaUrls(mediaNext);
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const t = setInterval(() => {
      setMessages((prev) => prev.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > Date.now()));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const otherMembers = useMemo(() => members.filter((m) => m.user_id !== user?.id), [members, user?.id]);
  const title = convMeta?.name || otherMembers.map((m) => m.display_name || m.username).join(", ") || "Chat";
  const subtitle =
    convMeta?.type === "group"
      ? `${members.length} members`
      : otherMembers[0]
        ? `Private chat with ${otherMembers[0].display_name || otherMembers[0].username}`
        : "Direct conversation";

  async function handleSendText() {
    if (!text.trim() || !user) return;
    const body = text.trim();
    setText("");
    try {
      await sendMessage({
        conversationId: convId,
        senderId: user.id,
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
      await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji);
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

  function messageText(m: MessageRow) {
    return m.ciphertext || "";
  }

  function groupedReactions(messageId: string) {
    return Object.entries(
      (reactions[messageId] ?? []).reduce<Record<string, number>>((acc, reaction) => {
        acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
        return acc;
      }, {}),
    );
  }

  return (
    <div className="app-shell-bg flex h-screen overflow-hidden p-0 md:p-4">
      <div className="hidden md:block md:w-[27rem] md:pr-4">
        <ChatSidebar activeId={convId} />
      </div>

      <main className="premium-panel relative flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-[30px]">
        <header className="premium-panel-soft sticky top-0 z-20 border-b subtle-divider px-4 py-4 md:px-6 md:py-5">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="interactive-surface inline-flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground md:hidden"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <Avatar name={title} url={otherMembers[0]?.avatar_url} size="md" />

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-[-0.025em] text-foreground md:text-lg">
                {title}
              </h1>
              <p className="truncate text-xs uppercase tracking-[0.18em] text-white/38 md:text-[11px]">
                {subtitle}
              </p>
            </div>

            <button
              onClick={() => setDisappearingMode(disappearing ? null : 60)}
              className={`quiet-hover inline-flex h-11 items-center gap-2 rounded-2xl border px-3.5 text-xs font-medium uppercase tracking-[0.18em] ${
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

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-5 md:px-6 md:py-6">
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

            {messages.map((m, i) => {
              const mine = m.sender_id === user?.id;
              const sender = senderOf(m.sender_id);
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const startsGroup = !prev || prev.sender_id !== m.sender_id;
              const endsGroup = !next || next.sender_id !== m.sender_id;
              const showSender = !mine && convMeta?.type === "group" && startsGroup;
              const replyMsg = m.reply_to ? messages.find((x) => x.id === m.reply_to) : null;
              const reactionSummary = groupedReactions(m.id);

              return (
                <div
                  key={m.id}
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

                  <div className={`flex max-w-[92%] items-end gap-2 md:max-w-[78%] ${mine ? "flex-row-reverse" : ""}`}>
                    <div className="relative">
                      {replyMsg && (
                        <div
                          className={`mb-2 rounded-[18px] border bg-white/[0.035] px-3 py-2 text-[11px] text-muted-foreground ${
                            mine ? "border-white/10" : "border-white/8"
                          }`}
                        >
                          <p className="font-medium text-foreground/72">
                            {senderOf(replyMsg.sender_id)?.display_name || senderOf(replyMsg.sender_id)?.username}
                          </p>
                          <p className="mt-1 line-clamp-1">{messageText(replyMsg) || "Media"}</p>
                        </div>
                      )}

                      <div
                        className={`relative overflow-hidden rounded-[26px] px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.18)] ${
                          mine
                            ? "bg-bubble-mine text-bubble-mine-foreground"
                            : "border border-white/8 bg-bubble-theirs text-bubble-theirs-foreground"
                        } ${startsGroup ? "" : mine ? "rounded-tr-[18px]" : "rounded-tl-[18px]"} ${
                          endsGroup ? "" : mine ? "rounded-br-[18px]" : "rounded-bl-[18px]"
                        }`}
                      >
                        {m.type === "text" && (
                          <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
                            {messageText(m) || "..."}
                          </p>
                        )}

                        {m.type === "image" && mediaUrls[m.id] && (
                          <img src={mediaUrls[m.id]} alt="Sent" className="max-h-[22rem] rounded-[18px]" />
                        )}
                        {m.type === "image" && !mediaUrls[m.id] && (
                          <div className="flex h-36 w-52 items-center justify-center rounded-[18px] bg-black/20 text-xs text-white/60">
                            Loading image
                          </div>
                        )}

                        {m.type === "voice" && mediaUrls[m.id] && (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <audio controls src={mediaUrls[m.id]} className="h-10 w-[16rem]" />
                        )}
                        {m.type === "voice" && !mediaUrls[m.id] && (
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

                      {showEmojiFor === m.id && (
                        <div
                          className={`premium-panel absolute z-10 mt-2 flex gap-1 rounded-full px-2 py-2 ${
                            mine ? "right-0" : "left-0"
                          }`}
                        >
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(m.id, emoji)}
                              className="interactive-surface rounded-full px-2 py-1 text-base"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 opacity-0 transition duration-150 group-hover:opacity-100">
                      <button
                        onClick={() => setShowEmojiFor(showEmojiFor === m.id ? null : m.id)}
                        className="interactive-surface inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        aria-label="React"
                      >
                        <Smile className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setReplyTarget(m)}
                        className="interactive-surface inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        aria-label="Reply"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                      {mine && (
                        <button
                          onClick={() => deleteMessage(m.id)}
                          className="interactive-surface inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <span
                    className={`mt-2 px-2 text-[10px] uppercase tracking-[0.16em] text-white/28 ${
                      reactionSummary.length > 0 ? "mt-5" : ""
                    }`}
                  >
                    {format(new Date(m.created_at), "HH:mm")}
                    {m.expires_at && " · vanishes"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {replyTarget && (
          <div className="border-t subtle-divider bg-white/[0.02] px-4 py-3 md:px-6">
            <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-[22px] premium-panel-soft px-3 py-3">
              <Reply className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/34">
                  Replying to {senderOf(replyTarget.sender_id)?.display_name || senderOf(replyTarget.sender_id)?.username}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {messageText(replyTarget) || "Media"}
                </p>
              </div>
              <button
                onClick={() => setReplyTarget(null)}
                className="interactive-surface inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="border-t subtle-divider bg-white/[0.02] px-3 py-3 md:px-6 md:py-5">
          <div className="mx-auto max-w-3xl">
            <div className="premium-panel flex items-end gap-2 rounded-[28px] px-3 py-3 md:px-4 md:py-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImage(file);
                  e.target.value = "";
                }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="interactive-surface inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground"
                aria-label="Send image"
              >
                <ImageIcon className="h-4.5 w-4.5" />
              </button>

              <div className="min-w-0 flex-1 rounded-[24px] border border-white/8 bg-black/10 px-4 py-2.5">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendText();
                    }
                  }}
                  placeholder="Write something thoughtful..."
                  rows={1}
                  className="max-h-40 w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>

              {text.trim() ? (
                <button
                  onClick={handleSendText}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_14px_30px_rgba(0,0,0,0.22)] quiet-hover hover:translate-y-[-1px] hover:opacity-95"
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
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl quiet-hover ${
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
