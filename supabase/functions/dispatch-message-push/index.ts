import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: "text" | "image" | "voice" | "system";
  ciphertext: string;
  created_at: string;
};

type PushTokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android" | "web";
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APNS_JWT_REFRESH_INTERVAL_SECONDS = 50 * 60;
const PUSH_DEBUG_ENABLED =
  (Deno.env.get("PUSH_DEBUG_LOGS") || "").toLowerCase() === "true" ||
  (Deno.env.get("APNS_USE_SANDBOX") || "").toLowerCase() === "true";
let cachedApnsJwt: { token: string; issuedAt: number } | null = null;

function logPushDebug(message: string, data?: Record<string, unknown>) {
  if (!PUSH_DEBUG_ENABLED) return;
  if (data) {
    console.info(`[dispatch-message-push] ${message}`, data);
    return;
  }
  console.info(`[dispatch-message-push] ${message}`);
}

function maskToken(token: string) {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function asJson(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function getEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getMessagePreview(message: MessageRow) {
  if (message.type === "text") {
    const trimmed = (message.ciphertext ?? "").trim();
    if (trimmed.length === 0) return "New message";
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  if (message.type === "image") return "Photo";
  if (message.type === "voice") return "Voice message";
  return "New message";
}

async function createApnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedApnsJwt && now - cachedApnsJwt.issuedAt < APNS_JWT_REFRESH_INTERVAL_SECONDS) {
    return cachedApnsJwt.token;
  }

  const privateKey = getEnv("APNS_PRIVATE_KEY").replace(/\\n/g, "\n");
  const teamId = getEnv("APNS_TEAM_ID");
  const keyId = getEnv("APNS_KEY_ID");
  const signingKey = await importPKCS8(privateKey, "ES256");

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(signingKey);

  cachedApnsJwt = { token, issuedAt: now };
  return token;
}

async function sendApnsNotification(args: {
  deviceToken: string;
  bearerToken: string;
  apnsTopic: string;
  payload: Record<string, unknown>;
  sandbox: boolean;
}) {
  const host = args.sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${args.deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${args.bearerToken}`,
      "apns-topic": args.apnsTopic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(args.payload),
  });

  const bodyText = await response.text();
  let reason: string | null = null;

  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as { reason?: string };
      reason = parsed.reason ?? null;
    } catch {
      reason = null;
    }
  }

  return {
    apnsId: response.headers.get("apns-id"),
    ok: response.ok,
    status: response.status,
    reason,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return asJson(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return asJson(401, { error: "Missing authorization header" });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return asJson(401, { error: "Invalid user token" });
    }

    const body = (await request.json()) as { messageId?: string };
    const messageId = body.messageId?.trim();
    if (!messageId) {
      return asJson(400, { error: "messageId is required" });
    }

    const { data: message, error: messageError } = await userClient
      .from("messages")
      .select("id, conversation_id, sender_id, type, ciphertext, created_at")
      .eq("id", messageId)
      .maybeSingle<MessageRow>();

    if (messageError || !message) {
      return asJson(404, { error: "Message not found" });
    }

    if (message.sender_id !== user.id) {
      return asJson(403, { error: "You can only dispatch push for your own messages" });
    }

    const { data: recipients, error: recipientError } = await adminClient
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", message.conversation_id)
      .neq("user_id", message.sender_id);

    if (recipientError) {
      return asJson(500, { error: recipientError.message });
    }

    const recipientIds = Array.from(new Set((recipients ?? []).map((row) => row.user_id))).filter(
      Boolean,
    );
    if (recipientIds.length === 0) {
      return asJson(200, { ok: true, sent: 0, skipped: 0, staleTokensDeleted: 0 });
    }

    const { data: senderProfile } = await adminClient
      .from("profiles")
      .select("display_name, username")
      .eq("id", message.sender_id)
      .maybeSingle<{ display_name: string | null; username: string | null }>();

    const senderName = senderProfile?.display_name || senderProfile?.username || "Someone";
    const preview = getMessagePreview(message);

    const { data: tokens, error: tokenError } = await adminClient
      .from("push_tokens")
      .select("id, user_id, token, platform")
      .in("user_id", recipientIds)
      .returns<PushTokenRow[]>();

    if (tokenError) {
      return asJson(500, { error: tokenError.message });
    }

    const iosTokens = (tokens ?? []).filter((row) => row.platform === "ios");
    const normalizedIosTokenRows = iosTokens
      .map((row) => ({ ...row, token: row.token.trim() }))
      .filter((row) => row.token.length > 0);
    const uniqueIosTokenByValue = new Map<string, PushTokenRow>();
    for (const row of normalizedIosTokenRows) {
      if (!uniqueIosTokenByValue.has(row.token)) {
        uniqueIosTokenByValue.set(row.token, row);
      }
    }
    const uniqueIosTokens = Array.from(uniqueIosTokenByValue.values());
    const duplicateIosTokenSkips = normalizedIosTokenRows.length - uniqueIosTokens.length;

    if (uniqueIosTokens.length === 0) {
      return asJson(200, {
        ok: true,
        sent: 0,
        skipped: (tokens ?? []).length,
        staleTokensDeleted: 0,
      });
    }

    const apnsTopic = getEnv("APNS_BUNDLE_ID").trim();
    if (!apnsTopic) {
      throw new Error("APNS_BUNDLE_ID must not be empty.");
    }
    const sandbox = (Deno.env.get("APNS_USE_SANDBOX") || "false").toLowerCase() === "true";
    logPushDebug("APNs delivery config", {
      apnsTopic,
      iosTokenRows: uniqueIosTokens.length,
      recipientIds: recipientIds.length,
      sandbox,
    });
    const apnsJwt = await createApnsJwt();
    const staleTokenIds: string[] = [];
    const failed: Array<{ reason: string | null; status: number }> = [];
    let sent = 0;

    for (const row of uniqueIosTokens) {
      const pushResult = await sendApnsNotification({
        deviceToken: row.token,
        bearerToken: apnsJwt,
        apnsTopic,
        sandbox,
        payload: {
          aps: {
            alert: {
              title: senderName,
              body: preview,
            },
            sound: "default",
          },
          conversation_id: message.conversation_id,
          message_id: message.id,
          sender_id: message.sender_id,
          created_at: message.created_at,
        },
      });
      if (pushResult.ok) {
        sent += 1;
      } else {
        failed.push({ reason: pushResult.reason, status: pushResult.status });
      }

      if (PUSH_DEBUG_ENABLED || !pushResult.ok) {
        const logger = pushResult.ok ? console.info : console.warn;
        logger("[dispatch-message-push] APNs response", {
          apnsId: pushResult.apnsId,
          reason: pushResult.reason,
          recipientUserId: row.user_id,
          status: pushResult.status,
          token: maskToken(row.token),
        });
      }

      if (pushResult.ok) continue;

      const shouldDeleteToken =
        pushResult.status === 410 ||
        pushResult.reason === "BadDeviceToken" ||
        pushResult.reason === "Unregistered" ||
        pushResult.reason === "DeviceTokenNotForTopic";

      if (shouldDeleteToken) {
        staleTokenIds.push(row.id);
      }
    }

    if (staleTokenIds.length > 0) {
      await adminClient.from("push_tokens").delete().in("id", staleTokenIds);
    }

    const skipped = (tokens ?? []).length - normalizedIosTokenRows.length + duplicateIosTokenSkips;

    return asJson(200, {
      ok: true,
      failed: failed.length,
      sent,
      skipped,
      staleTokensDeleted: staleTokenIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return asJson(500, { error: message });
  }
});
