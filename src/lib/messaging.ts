import { supabase } from "@/integrations/supabase/client";
import { dispatchNewMessagePush } from "@/lib/push";
import { computeExpiryIso } from "@/lib/voidMode";

// Legacy schema note:
// `ciphertext`, `nonce`, and `recipient_keys` are historical encryption-era columns.
// The current frontend stores plain text in `ciphertext` and leaves the other fields empty.

export interface ConversationSummary {
  id: string;
  type: "dm" | "group";
  name: string | null;
  avatar_url: string | null;
  disappearing_seconds: number | null;
  updated_at: string;
  members: {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  }[];
  last_message?: {
    ciphertext: string;
    nonce: string;
    recipient_keys: Record<string, string>;
    sender_id: string;
    type: string;
    is_void_mode: boolean;
    void_expires_at: string | null;
    void_duration_seconds: number | null;
    created_at: string;
  } | null;
}

interface RawConversationMember {
  conversation_id: string;
  user_id: string;
}

interface MessageVisibilityShape {
  is_void_mode?: boolean | null;
  void_expires_at?: string | null;
  expires_at?: string | null;
}

function isMissingVoidColumnsError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: string; message?: string };
  if (candidate.code !== "42703") return false;

  const message = candidate.message ?? "";
  return (
    message.includes("is_void_mode") ||
    message.includes("void_expires_at") ||
    message.includes("void_duration_seconds")
  );
}

function resolveVoidExpiryAt(message: MessageVisibilityShape) {
  if (!message.is_void_mode) return null;
  // Legacy fallback for environments that still used `expires_at` for void messages.
  return message.void_expires_at ?? message.expires_at ?? null;
}

function isVisibleMessage(message: MessageVisibilityShape, nowMs = Date.now()) {
  const expiry = resolveVoidExpiryAt(message);
  if (!expiry) return true;
  return new Date(expiry).getTime() > nowMs;
}

export function getMessageBody(
  message: Pick<ConversationSummary["last_message"], "ciphertext"> | { ciphertext: string },
) {
  return message.ciphertext ?? "";
}

export function getConversationPreview(lastMessage: ConversationSummary["last_message"]) {
  if (!lastMessage) return "Say hi";
  if (lastMessage.type === "text") return getMessageBody(lastMessage) || "Say hi";
  return lastMessage.type === "image" ? "Photo" : "Voice note";
}

export async function listUnreadCounts(userId: string): Promise<Record<string, number>> {
  if (!userId) return {};

  const { data: memberships, error: membershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);
  if (membershipError) throw membershipError;

  const conversationIds = (memberships ?? []).map((membership) => membership.conversation_id);
  if (conversationIds.length === 0) return {};

  const lastReadAtByConversation = new Map(
    (memberships ?? []).map((membership) => [
      membership.conversation_id,
      membership.last_read_at ?? null,
    ]),
  );

  let messages: Array<{
    conversation_id: string;
    sender_id: string;
    created_at: string;
    is_void_mode?: boolean | null;
    void_expires_at?: string | null;
    expires_at?: string | null;
  }> = [];

  const unreadRowsWithVoid = await supabase
    .from("messages")
    .select("conversation_id, sender_id, created_at, is_void_mode, void_expires_at, expires_at")
    .in("conversation_id", conversationIds)
    .neq("sender_id", userId);
  if (unreadRowsWithVoid.error) {
    if (!isMissingVoidColumnsError(unreadRowsWithVoid.error)) {
      throw unreadRowsWithVoid.error;
    }

    const unreadRowsLegacy = await supabase
      .from("messages")
      .select("conversation_id, sender_id, created_at")
      .in("conversation_id", conversationIds)
      .neq("sender_id", userId);
    if (unreadRowsLegacy.error) throw unreadRowsLegacy.error;
    messages = (unreadRowsLegacy.data ?? []) as typeof messages;
  } else {
    messages = (unreadRowsWithVoid.data ?? []) as typeof messages;
  }

  return (messages ?? []).reduce<Record<string, number>>((acc, message) => {
    if (!isVisibleMessage(message)) return acc;
    const lastReadAt = lastReadAtByConversation.get(message.conversation_id);
    if (!lastReadAt || new Date(message.created_at).getTime() > new Date(lastReadAt).getTime()) {
      acc[message.conversation_id] = (acc[message.conversation_id] || 0) + 1;
    }
    return acc;
  }, {});
}

export async function markConversationRead(
  conversationId: string,
  userId: string,
  messages: { id: string; sender_id: string; created_at: string }[],
  lastReadAt?: string | null,
) {
  const latestIncomingMessage = [...messages]
    .reverse()
    .find((message) => message.sender_id !== userId);

  if (!latestIncomingMessage) return lastReadAt ?? null;

  if (
    lastReadAt &&
    new Date(latestIncomingMessage.created_at).getTime() <= new Date(lastReadAt).getTime()
  ) {
    return lastReadAt;
  }

  const nextLastReadAt = latestIncomingMessage.created_at;

  const { error: memberError } = await supabase
    .from("conversation_members")
    .update({ last_read_at: nextLastReadAt })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (memberError) throw memberError;

  const { error: receiptError } = await supabase.from("read_receipts").insert({
    message_id: latestIncomingMessage.id,
    user_id: userId,
  });

  if (receiptError && receiptError.code !== "23505") {
    throw receiptError;
  }

  return nextLastReadAt;
}

function mapConversationMember(
  member: RawConversationMember,
  profileById: Map<
    string,
    { username: string; display_name: string | null; avatar_url: string | null }
  >,
) {
  const profile = profileById.get(member.user_id);
  return {
    user_id: member.user_id,
    username: profile?.username ?? "unknown",
    display_name: profile?.display_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
  };
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  if (!userId) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  if (memberError) throw memberError;

  const conversationIds = (memberRows ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return [];

  const { data: conversations, error: conversationError } = await supabase
    .from("conversations")
    .select("id, type, name, avatar_url, disappearing_seconds, updated_at")
    .in("id", conversationIds)
    .order("updated_at", { ascending: false });
  if (conversationError) throw conversationError;

  const { data: allMembers, error: allMembersError } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds);
  if (allMembersError) throw allMembersError;

  const memberUserIds = Array.from(new Set((allMembers ?? []).map((member) => member.user_id)));
  let profileById = new Map<
    string,
    { username: string; display_name: string | null; avatar_url: string | null }
  >();

  if (memberUserIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", memberUserIds);
    if (profileError) throw profileError;

    profileById = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        {
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        },
      ]),
    );
  }

  let lastMessages: Array<{
    conversation_id: string;
    ciphertext: string;
    nonce: string;
    recipient_keys: unknown;
    sender_id: string;
    type: string;
    created_at: string;
    is_void_mode?: boolean | null;
    void_expires_at?: string | null;
    void_duration_seconds?: number | null;
  }> = [];

  const lastMessagesWithVoid = await supabase
    .from("messages")
    .select(
      "conversation_id, ciphertext, nonce, recipient_keys, sender_id, type, is_void_mode, void_expires_at, void_duration_seconds, expires_at, created_at",
    )
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  if (lastMessagesWithVoid.error) {
    if (!isMissingVoidColumnsError(lastMessagesWithVoid.error)) {
      throw lastMessagesWithVoid.error;
    }

    const lastMessagesLegacy = await supabase
      .from("messages")
      .select("conversation_id, ciphertext, nonce, recipient_keys, sender_id, type, expires_at, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });
    if (lastMessagesLegacy.error) throw lastMessagesLegacy.error;
    lastMessages = (lastMessagesLegacy.data ?? []) as typeof lastMessages;
  } else {
    lastMessages = (lastMessagesWithVoid.data ?? []) as typeof lastMessages;
  }

  const lastMessageByConversation = new Map<string, ConversationSummary["last_message"]>();
  const visibleMessages = (lastMessages ?? []).filter((message) => isVisibleMessage(message));
  for (const message of visibleMessages) {
    if (!lastMessageByConversation.has(message.conversation_id)) {
      lastMessageByConversation.set(message.conversation_id, {
        ciphertext: message.ciphertext,
        nonce: message.nonce,
        recipient_keys: message.recipient_keys as Record<string, string>,
        sender_id: message.sender_id,
        type: message.type,
        is_void_mode: message.is_void_mode ?? false,
        void_expires_at: message.void_expires_at ?? null,
        void_duration_seconds: message.void_duration_seconds ?? null,
        created_at: message.created_at,
      });
    }
  }

  const membersByConversation = new Map<string, ConversationSummary["members"]>();
  for (const member of (allMembers ?? []) as RawConversationMember[]) {
    const mappedMember = mapConversationMember(member, profileById);
    const existing = membersByConversation.get(member.conversation_id) ?? [];
    existing.push(mappedMember);
    membersByConversation.set(member.conversation_id, existing);
  }

  return (conversations ?? []).map((conversation) => ({
    ...conversation,
    type: conversation.type as "dm" | "group",
    members: membersByConversation.get(conversation.id) ?? [],
    last_message: lastMessageByConversation.get(conversation.id) ?? null,
  }));
}

export async function findOrCreateDM(myId: string, otherId: string): Promise<string> {
  if (!myId || !otherId) throw new Error("Missing user id");
  if (myId === otherId) throw new Error("Cannot create a DM with yourself.");

  const untypedClient = supabase as unknown as {
    rpc: (
      functionName: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>;
  };

  const { data, error } = await untypedClient.rpc("find_or_create_dm", {
    other_user_id: otherId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Failed to create direct message.");
  return data;
}

export async function createGroup(myId: string, name: string, memberIds: string[]) {
  if (!myId) throw new Error("Missing user id");

  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean))).filter(
    (id) => id !== myId,
  );
  const conversationId = crypto.randomUUID();

  const { error: conversationError } = await supabase
    .from("conversations")
    .insert({ id: conversationId, type: "group", name: name.trim(), created_by: myId });
  if (conversationError) throw conversationError;

  const rows = [
    { conversation_id: conversationId, user_id: myId, role: "owner" },
    ...uniqueMemberIds.map((memberId) => ({
      conversation_id: conversationId,
      user_id: memberId,
      role: "member",
    })),
  ];
  const { error: memberError } = await supabase.from("conversation_members").insert(rows);
  if (memberError) throw memberError;

  return conversationId;
}

interface SendOptions {
  conversationId: string;
  senderId: string;
  type: "text" | "image" | "voice";
  text?: string;
  blob?: Blob;
  replyTo?: string | null;
  voidModeDurationSec?: number | null;
}

function getVoiceMediaExtension(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("audio/mp4") || normalized.includes("audio/aac")) return "m4a";
  if (normalized.includes("audio/ogg")) return "ogg";
  if (normalized.includes("audio/mpeg")) return "mp3";
  return "webm";
}

export async function sendMessage(opts: SendOptions) {
  if (!opts.conversationId || !opts.senderId) {
    throw new Error("Missing conversation or sender");
  }

  let storedText = opts.text?.trim() ?? "";
  let mediaPath: string | null = null;

  if (opts.type === "text") {
    if (!storedText) throw new Error("Message cannot be empty");
  } else {
    if (!opts.blob || opts.blob.size === 0) throw new Error("Media file is missing");
    const ext =
      opts.type === "image" ? "jpg" : getVoiceMediaExtension(opts.blob.type || "audio/webm");
    const filename = `${opts.senderId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(filename, opts.blob, {
        contentType: opts.blob.type || (opts.type === "image" ? "image/jpeg" : "audio/webm"),
      });
    if (uploadError) throw uploadError;
    mediaPath = filename;
    storedText = "";
  }

  const voidDurationSeconds =
    typeof opts.voidModeDurationSec === "number" && opts.voidModeDurationSec > 0
      ? opts.voidModeDurationSec
      : null;
  const voidExpiresAt = voidDurationSeconds ? computeExpiryIso(voidDurationSeconds) : null;

  const basePayload = {
    conversation_id: opts.conversationId,
    sender_id: opts.senderId,
    type: opts.type,
    ciphertext: storedText,
    nonce: "",
    recipient_keys: {},
    media_path: mediaPath,
    reply_to: opts.replyTo ?? null,
  };

  let insertedMessage: { id: string } | null = null;
  try {
    if (voidDurationSeconds) {
      const withVoidColumns = await supabase
        .from("messages")
        .insert({
          ...basePayload,
          is_void_mode: true,
          void_expires_at: voidExpiresAt,
          void_duration_seconds: voidDurationSeconds,
          expires_at: voidExpiresAt,
        })
        .select("id")
        .single();

      if (withVoidColumns.error) {
        if (!isMissingVoidColumnsError(withVoidColumns.error)) {
          throw withVoidColumns.error;
        }

        // Legacy fallback for environments missing void columns.
        const legacyInsert = await supabase
          .from("messages")
          .insert({
            ...basePayload,
            expires_at: voidExpiresAt,
          })
          .select("id")
          .single();
        if (legacyInsert.error) throw legacyInsert.error;
        insertedMessage = legacyInsert.data;
      } else {
        insertedMessage = withVoidColumns.data;
      }
    } else {
      const regularInsert = await supabase
        .from("messages")
        .insert({
          ...basePayload,
          is_void_mode: false,
          void_expires_at: null,
          void_duration_seconds: null,
          expires_at: null,
        })
        .select("id")
        .single();

      if (regularInsert.error) {
        if (!isMissingVoidColumnsError(regularInsert.error)) {
          throw regularInsert.error;
        }

        // Legacy fallback for environments missing void columns.
        const legacyInsert = await supabase
          .from("messages")
          .insert({
            ...basePayload,
            expires_at: null,
          })
          .select("id")
          .single();
        if (legacyInsert.error) throw legacyInsert.error;
        insertedMessage = legacyInsert.data;
      } else {
        insertedMessage = regularInsert.data;
      }
    }

    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", opts.conversationId);
    if (conversationError) throw conversationError;
  } catch (error) {
    if (mediaPath && !insertedMessage?.id) {
      const { error: cleanupError } = await supabase.storage.from("chat-media").remove([mediaPath]);
      if (cleanupError) {
        console.error("Failed to clean up orphaned media after send failure", cleanupError);
      }
    }
    throw error;
  }

  if (insertedMessage?.id) {
    void dispatchNewMessagePush(insertedMessage.id).catch((error) => {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Push dispatch failed", message);
    });
  }
}

export async function downloadMedia(mediaPath: string): Promise<Blob | null> {
  if (!mediaPath) return null;

  const { data, error } = await supabase.storage.from("chat-media").download(mediaPath);
  if (error || !data) return null;
  return data;
}
