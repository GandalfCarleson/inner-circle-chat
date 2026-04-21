import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const CALLING_ENABLED = import.meta.env.VITE_ENABLE_CALLING_MVP === "true";

export type CallType = "audio" | "video";
export type CallStatus = "ringing" | "accepted" | "declined" | "ended" | "missed";

export interface CallSession {
  id: string;
  conversation_id: string;
  caller_user_id: string;
  callee_user_id: string;
  type: CallType;
  status: CallStatus;
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
}

export interface CallPeerProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export const TERMINAL_CALL_STATUSES: ReadonlySet<CallStatus> = new Set([
  "declined",
  "ended",
  "missed",
]);

export function isTerminalCallStatus(status: CallStatus) {
  return TERMINAL_CALL_STATUSES.has(status);
}

export type CallSignalMessage =
  | {
      type: "offer";
      call_session_id: string;
      from_user_id: string;
      description: RTCSessionDescriptionInit;
      ts: string;
    }
  | {
      type: "answer";
      call_session_id: string;
      from_user_id: string;
      description: RTCSessionDescriptionInit;
      ts: string;
    }
  | {
      type: "ice-candidate";
      call_session_id: string;
      from_user_id: string;
      candidate: RTCIceCandidateInit;
      ts: string;
    }
  | {
      type: "decline" | "hangup";
      call_session_id: string;
      from_user_id: string;
      reason?: string;
      ts: string;
    };

interface UntypedCallSessionApi {
  insert: (payload: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<{ data: CallSession | null; error: { message: string } | null }>;
    };
  };
  update: (payload: Record<string, unknown>) => {
    eq: (
      column: string,
      value: string,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => {
        select: (
          columns: string,
        ) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
      };
    };
  };
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => Promise<{ data: CallSession | null; error: { message: string } | null }>;
    };
  };
}

interface UntypedCallSessionListApi {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          args: { ascending: boolean },
        ) => {
          limit: (
            count: number,
          ) => Promise<{ data: CallSession[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

interface UntypedProfileApi {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => Promise<{
        data: CallPeerProfile | null;
        error: { message: string } | null;
      }>;
    };
  };
}

function formatSupabaseError(
  error: {
    message?: string | null;
    details?: string | null;
    hint?: string | null;
    code?: string | null;
  } | null,
) {
  if (!error) return "Unknown Supabase error";
  const parts = [error.message, error.details, error.hint].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const base = parts.join(" | ");
  if (error.code && error.code.trim().length > 0) {
    return base ? `${base} (code: ${error.code})` : `Supabase error code: ${error.code}`;
  }
  return base || "Unknown Supabase error";
}

function callSessionsTable(): UntypedCallSessionApi {
  const rawClient = supabase as unknown as {
    from: (table: string) => UntypedCallSessionApi;
  };
  return rawClient.from("call_sessions");
}

function callSessionsListTable(): UntypedCallSessionListApi {
  const rawClient = supabase as unknown as {
    from: (table: string) => UntypedCallSessionListApi;
  };
  return rawClient.from("call_sessions");
}

function profilesTable(): UntypedProfileApi {
  const rawClient = supabase as unknown as {
    from: (table: string) => UntypedProfileApi;
  };
  return rawClient.from("profiles");
}

export async function createCallSession(args: {
  conversationId: string;
  callerUserId: string;
  calleeUserId: string;
  type: CallType;
}) {
  const { data, error } = await callSessionsTable()
    .insert({
      conversation_id: args.conversationId,
      caller_user_id: args.callerUserId,
      callee_user_id: args.calleeUserId,
      type: args.type,
      status: "ringing",
    })
    .select(
      "id, conversation_id, caller_user_id, callee_user_id, type, status, created_at, accepted_at, ended_at",
    )
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error));
  }

  return data;
}

export async function setCallSessionStatus(args: {
  callSessionId: string;
  participantUserId: string;
  status: CallStatus;
}) {
  const patch: Record<string, unknown> = {
    status: args.status,
  };

  if (args.status === "accepted") {
    patch.accepted_at = new Date().toISOString();
  }

  if (args.status === "declined" || args.status === "ended" || args.status === "missed") {
    patch.ended_at = new Date().toISOString();
  }

  const { data: callerRows, error: callerError } = await callSessionsTable()
    .update(patch)
    .eq("id", args.callSessionId)
    .eq("caller_user_id", args.participantUserId)
    .select("id");

  if (callerError) throw new Error(formatSupabaseError(callerError));
  if ((callerRows?.length ?? 0) > 0) return;

  const { data: calleeRows, error: calleeError } = await callSessionsTable()
    .update(patch)
    .eq("id", args.callSessionId)
    .eq("callee_user_id", args.participantUserId)
    .select("id");

  if (calleeError) throw new Error(formatSupabaseError(calleeError));
  if ((calleeRows?.length ?? 0) > 0) return;

  throw new Error("Call session not found or access denied");
}

export async function getCallSessionById(callSessionId: string) {
  const { data, error } = await callSessionsTable()
    .select(
      "id, conversation_id, caller_user_id, callee_user_id, type, status, created_at, accepted_at, ended_at",
    )
    .eq("id", callSessionId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return data;
}

export async function listRingingCallSessionsForCallee(calleeUserId: string, limit = 5) {
  const { data, error } = await callSessionsListTable()
    .select(
      "id, conversation_id, caller_user_id, callee_user_id, type, status, created_at, accepted_at, ended_at",
    )
    .eq("callee_user_id", calleeUserId)
    .eq("status", "ringing")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(formatSupabaseError(error));
  return data ?? [];
}

export async function getCallPeerProfile(userId: string) {
  const { data, error } = await profilesTable()
    .select("id, username, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(formatSupabaseError(error));
  return data;
}

export function getCallSignalTopic(callSessionId: string) {
  return `call-signal:${callSessionId}`;
}

export function createSignalChannel(callSessionId: string) {
  return supabase.channel(getCallSignalTopic(callSessionId), {
    config: {
      broadcast: { self: true },
    },
  });
}

export async function sendSignal(channel: RealtimeChannel, payload: CallSignalMessage) {
  const status = await channel.send({
    type: "broadcast",
    event: "signal",
    payload,
  });

  if (status !== "ok") {
    throw new Error(`Failed to send signal (${status})`);
  }
}

export function buildSignalBase(callSessionId: string, fromUserId: string) {
  return {
    call_session_id: callSessionId,
    from_user_id: fromUserId,
    ts: new Date().toISOString(),
  };
}
