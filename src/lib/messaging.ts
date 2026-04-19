import { supabase } from "@/integrations/supabase/client";
import {
  encryptForRecipients,
  decryptForMe,
  decryptText,
  fileToBytes,
  bytesToBlob,
  getPrivateKey,
} from "@/lib/crypto";

export interface ConversationSummary {
  id: string;
  type: "dm" | "group";
  name: string | null;
  avatar_url: string | null;
  disappearing_seconds: number | null;
  updated_at: string;
  members: { user_id: string; username: string; display_name: string | null; avatar_url: string | null; public_key: string | null }[];
  last_message?: { ciphertext: string; nonce: string; recipient_keys: Record<string, string>; sender_id: string; type: string; created_at: string } | null;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  // Get conversations the user is a member of
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
    .select("conversation_id, user_id, profiles!inner(username, display_name, avatar_url, public_key)")
    .in("conversation_id", ids);

  // last messages
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
        public_key: m.profiles.public_key,
      })),
    last_message: lastByConv.get(c.id) ?? null,
  }));
}

export async function findOrCreateDM(myId: string, otherId: string): Promise<string> {
  // find a DM where both are members
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

  // create new
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ type: "dm", created_by: myId })
    .select("id")
    .single();
  if (error || !conv) throw error ?? new Error("Failed to create conversation");

  const { error: memErr } = await supabase
    .from("conversation_members")
    .insert([
      { conversation_id: conv.id, user_id: myId, role: "member" },
      { conversation_id: conv.id, user_id: otherId, role: "member" },
    ]);
  if (memErr) throw memErr;
  return conv.id;
}

export async function createGroup(myId: string, name: string, memberIds: string[]) {
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ type: "group", name, created_by: myId })
    .select("id")
    .single();
  if (error || !conv) throw error ?? new Error("Failed");
  const rows = [{ conversation_id: conv.id, user_id: myId, role: "owner" }, ...memberIds.map((u) => ({ conversation_id: conv.id, user_id: u, role: "member" }))];
  const { error: memErr } = await supabase.from("conversation_members").insert(rows);
  if (memErr) throw memErr;
  return conv.id;
}

interface SendOptions {
  conversationId: string;
  senderId: string;
  recipients: { userId: string; publicKey: string }[];
  type: "text" | "image" | "voice";
  text?: string;
  blob?: Blob;
  blobMime?: string;
  replyTo?: string | null;
  expiresInSec?: number | null;
}

export async function sendMessage(opts: SendOptions) {
  let plaintext: Uint8Array;
  let mediaPath: string | null = null;

  if (opts.type === "text") {
    plaintext = new TextEncoder().encode(opts.text ?? "");
  } else {
    if (!opts.blob) throw new Error("blob required");
    plaintext = await fileToBytes(opts.blob);
  }

  const enc = await encryptForRecipients(plaintext, opts.recipients);

  if (opts.type !== "text") {
    // Upload encrypted media
    const filename = `${opts.senderId}/${crypto.randomUUID()}.bin`;
    const cipherBytes = Uint8Array.from(atob(enc.ciphertext), (c) => c.charCodeAt(0));
    const ab = new ArrayBuffer(cipherBytes.byteLength);
    new Uint8Array(ab).set(cipherBytes);
    const { error: upErr } = await supabase.storage
      .from("chat-media")
      .upload(filename, new Blob([ab], { type: "application/octet-stream" }));
    if (upErr) throw upErr;
    mediaPath = filename;
    // for media, we keep ciphertext empty placeholder + media_path
    enc.ciphertext = "";
  }

  const expires_at = opts.expiresInSec
    ? new Date(Date.now() + opts.expiresInSec * 1000).toISOString()
    : null;

  const { error } = await supabase.from("messages").insert({
    conversation_id: opts.conversationId,
    sender_id: opts.senderId,
    type: opts.type,
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    recipient_keys: enc.recipientKeys,
    media_path: mediaPath,
    reply_to: opts.replyTo ?? null,
    expires_at,
    // include mime in recipient_keys hack? store mime in nonce? — better: stash on ciphertext as JSON when media
  });
  if (error) throw error;

  // bump conversation updated_at
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", opts.conversationId);
}

export async function decryptMessageText(
  msg: { ciphertext: string; nonce: string; recipient_keys: Record<string, string> },
  myId: string,
  myPublicKey: string,
): Promise<string | null> {
  const myKey = msg.recipient_keys?.[myId];
  if (!myKey) return null;
  const priv = await getPrivateKey(myId);
  if (!priv) return null;
  return decryptText(msg.ciphertext, msg.nonce, myKey, myPublicKey, priv);
}

export async function downloadAndDecryptMedia(
  mediaPath: string,
  msg: { nonce: string; recipient_keys: Record<string, string> },
  myId: string,
  myPublicKey: string,
  mime: string,
): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from("chat-media").download(mediaPath);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const ctB64 = btoa(String.fromCharCode(...bytes));
  const myKey = msg.recipient_keys?.[myId];
  if (!myKey) return null;
  const priv = await getPrivateKey(myId);
  if (!priv) return null;
  const plain = await decryptForMe(ctB64, msg.nonce, myKey, myPublicKey, priv);
  if (!plain) return null;
  return bytesToBlob(plain, mime);
}
