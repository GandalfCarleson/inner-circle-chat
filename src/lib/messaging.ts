import { supabase } from "@/integrations/supabase/client";

export interface ConversationSummary {
  id: string;
  type: "dm" | "group";
  name: string | null;
  avatar_url: string | null;
  disappearing_seconds: number | null;
  updated_at: string;
  members: { user_id: string; username: string; display_name: string | null; avatar_url: string | null }[];
  last_message?: { ciphertext: string; nonce: string; recipient_keys: Record<string, string>; sender_id: string; type: string; created_at: string } | null;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const { data: memberRows, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  if (error) throw error;
  const ids = (memberRows ?? []).map((r) => r.conversation_id);
  if (ids.length === 0) return [];

  const { data: convs } = await supabase
    .from("conversations")
    .select("id, type, name, avatar_url, disappearing_seconds, updated_at")
    .in("id", ids)
    .order("updated_at", { ascending: false });

  const { data: allMembers } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id, profiles!inner(username, display_name, avatar_url)")
    .in("conversation_id", ids);

  const { data: lastMsgs } = await supabase
    .from("messages")
    .select("conversation_id, ciphertext, nonce, recipient_keys, sender_id, type, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });

  const lastByConv = new Map<string, ConversationSummary["last_message"]>();
  for (const m of lastMsgs ?? []) {
    if (!lastByConv.has(m.conversation_id)) {
      lastByConv.set(m.conversation_id, {
        ciphertext: m.ciphertext,
        nonce: m.nonce,
        recipient_keys: m.recipient_keys as Record<string, string>,
        sender_id: m.sender_id,
        type: m.type,
        created_at: m.created_at,
      });
    }
  }

  return (convs ?? []).map((c) => ({
    ...c,
    type: c.type as "dm" | "group",
    members: (allMembers ?? [])
      .filter((m) => m.conversation_id === c.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({
        user_id: m.user_id,
        username: m.profiles.username,
        display_name: m.profiles.display_name,
        avatar_url: m.profiles.avatar_url,
      })),
    last_message: lastByConv.get(c.id) ?? null,
  }));
}

export async function findOrCreateDM(myId: string, otherId: string): Promise<string> {
  const { data: mine } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations!inner(type)")
    .eq("user_id", myId);

  const dmIds = (mine ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => r.conversations.type === "dm")
    .map((r) => r.conversation_id);

  if (dmIds.length > 0) {
    const { data: other } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", otherId)
      .in("conversation_id", dmIds);
    if (other && other.length > 0) return other[0].conversation_id;
  }

  const conversationId = crypto.randomUUID();
  const { error } = await supabase
    .from("conversations")
    .insert({ id: conversationId, type: "dm", created_by: myId });
  if (error) throw error;

  const { error: memErr } = await supabase
    .from("conversation_members")
    .insert([
      { conversation_id: conversationId, user_id: myId, role: "member" },
      { conversation_id: conversationId, user_id: otherId, role: "member" },
    ]);
  if (memErr) throw memErr;
  return conversationId;
}

export async function createGroup(myId: string, name: string, memberIds: string[]) {
  const conversationId = crypto.randomUUID();
  const { error } = await supabase
    .from("conversations")
    .insert({ id: conversationId, type: "group", name, created_by: myId });
  if (error) throw error;
  const rows = [{ conversation_id: conversationId, user_id: myId, role: "owner" }, ...memberIds.map((u) => ({ conversation_id: conversationId, user_id: u, role: "member" }))];
  const { error: memErr } = await supabase.from("conversation_members").insert(rows);
  if (memErr) throw memErr;
  return conversationId;
}

interface SendOptions {
  conversationId: string;
  senderId: string;
  type: "text" | "image" | "voice";
  text?: string;
  blob?: Blob;
  blobMime?: string;
  replyTo?: string | null;
  expiresInSec?: number | null;
}

export async function sendMessage(opts: SendOptions) {
  let ciphertext = opts.text ?? "";
  let mediaPath: string | null = null;

  if (opts.type !== "text") {
    if (!opts.blob) throw new Error("blob required");
    const ext = opts.type === "image" ? "jpg" : "webm";
    const filename = `${opts.senderId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("chat-media")
      .upload(filename, opts.blob, {
        contentType: opts.blob.type || (opts.type === "image" ? "image/jpeg" : "audio/webm"),
      });
    if (upErr) throw upErr;
    mediaPath = filename;
    ciphertext = "";
  }

  const expires_at = opts.expiresInSec
    ? new Date(Date.now() + opts.expiresInSec * 1000).toISOString()
    : null;

  const { error } = await supabase.from("messages").insert({
    conversation_id: opts.conversationId,
    sender_id: opts.senderId,
    type: opts.type,
    ciphertext,
    nonce: "",
    recipient_keys: {},
    media_path: mediaPath,
    reply_to: opts.replyTo ?? null,
    expires_at,
  });
  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", opts.conversationId);
}

export async function getMessageText(
  msg: { ciphertext: string },
): Promise<string | null> {
  return msg.ciphertext ?? null;
}

export async function downloadMedia(
  mediaPath: string,
): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from("chat-media").download(mediaPath);
  if (error || !data) return null;
  return data;
}
