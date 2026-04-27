import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

const PUSH_PERMISSION_REQUESTED_KEY = "void.push.permission.requested.v1";
const TOKEN_WAIT_TIMEOUT_MS = 15000;
const PUSH_DISPATCH_ENABLED_IN_DEV = import.meta.env.VITE_ENABLE_PUSH_DISPATCH_IN_DEV === "true";
const CAN_DISPATCH_PUSH = !import.meta.env.DEV || PUSH_DISPATCH_ENABLED_IN_DEV;

let hasLoggedPushDispatchDevSkip = false;
let hasLoggedPushFunctionMissing = false;
let lastPushDispatchFetchErrorAt = 0;

type PushTokenRow = {
  user_id: string;
  token: string;
  platform: "ios" | "android" | "web";
  updated_at?: string;
};

export type PushRegistrationResult =
  | { status: "granted"; token: string; platform: "ios" | "android" }
  | { status: "denied" }
  | { status: "skipped" }
  | { status: "unsupported" };

function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function getPushPlatform(): "ios" | "android" | "web" {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  return "web";
}

function hasRequestedPermissionBefore() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUSH_PERMISSION_REQUESTED_KEY) === "1";
}

function markPermissionRequested() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUSH_PERMISSION_REQUESTED_KEY, "1");
}

async function requestPushPermissionOnce() {
  const initial = await PushNotifications.checkPermissions();
  let receive = initial.receive;

  if (receive === "prompt-with-rationale") {
    receive = "prompt";
  }

  if (receive === "prompt") {
    if (hasRequestedPermissionBefore()) {
      return "skipped" as const;
    }
    const requested = await PushNotifications.requestPermissions();
    markPermissionRequested();
    receive = requested.receive;
  }

  if (receive !== "granted") {
    return "denied" as const;
  }

  return "granted" as const;
}

async function registerForPushToken() {
  return new Promise<string>(async (resolve, reject) => {
    let registrationHandle:
      | {
          remove: () => Promise<void>;
        }
      | undefined;
    let registrationErrorHandle:
      | {
          remove: () => Promise<void>;
        }
      | undefined;

    const cleanup = async () => {
      await Promise.allSettled([registrationHandle?.remove(), registrationErrorHandle?.remove()]);
    };

    const timeout = window.setTimeout(async () => {
      await cleanup();
      reject(new Error("Timed out while waiting for push registration token."));
    }, TOKEN_WAIT_TIMEOUT_MS);

    try {
      registrationHandle = await PushNotifications.addListener("registration", async (token) => {
        window.clearTimeout(timeout);
        await cleanup();
        resolve(token.value);
      });

      registrationErrorHandle = await PushNotifications.addListener("registrationError", async (error) => {
        window.clearTimeout(timeout);
        await cleanup();
        const message =
          typeof error.error === "string"
            ? error.error
            : JSON.stringify(error.error ?? error ?? "Unknown push registration error");
        reject(new Error(message));
      });

      await PushNotifications.register();
    } catch (error) {
      window.clearTimeout(timeout);
      await cleanup();
      reject(error);
    }
  });
}

export async function upsertPushToken(row: PushTokenRow) {
  const untypedClient = supabase as unknown as {
    from: (tableName: string) => {
      upsert: (
        payload: PushTokenRow[],
        options: {
          onConflict: string;
        },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };

  const { error } = await untypedClient.from("push_tokens").upsert(
    [{ ...row, updated_at: new Date().toISOString() }],
    { onConflict: "user_id,token" },
  );
  if (error) throw new Error(error.message);
}

export async function registerAndStorePushToken(userId: string): Promise<PushRegistrationResult> {
  if (!userId || !isNativePlatform()) {
    return { status: "unsupported" };
  }

  const platform = getPushPlatform();
  if (platform !== "ios" && platform !== "android") {
    return { status: "unsupported" };
  }

  const permissionState = await requestPushPermissionOnce();
  if (permissionState === "denied") return { status: "denied" };
  if (permissionState === "skipped") return { status: "skipped" };

  const token = await registerForPushToken();

  await upsertPushToken({
    user_id: userId,
    token,
    platform,
  });

  return { status: "granted", token, platform };
}

export async function dispatchNewMessagePush(messageId: string) {
  if (!messageId) return;

  if (!CAN_DISPATCH_PUSH) {
    if (!hasLoggedPushDispatchDevSkip) {
      hasLoggedPushDispatchDevSkip = true;
      console.info(
        "Push dispatch skipped in development. Set VITE_ENABLE_PUSH_DISPATCH_IN_DEV=true to enable.",
      );
    }
    return;
  }

  const { error } = await supabase.functions.invoke("dispatch-message-push", {
    body: { messageId },
  });
  if (!error) return;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  const missingFunction =
    message.includes("NOT_FOUND") ||
    message.includes("Requested function was not found") ||
    message.includes("404");

  if (missingFunction) {
    if (!hasLoggedPushFunctionMissing) {
      hasLoggedPushFunctionMissing = true;
      console.warn(
        "Push dispatch edge function is unavailable (dispatch-message-push). Deploy it to Supabase to enable notifications.",
      );
    }
    return;
  }

  const fetchFailure =
    message.includes("FunctionsFetchError") ||
    message.includes("Failed to send a request to the Edge Function");
  if (fetchFailure) {
    const now = Date.now();
    if (now - lastPushDispatchFetchErrorAt > 30_000) {
      lastPushDispatchFetchErrorAt = now;
      console.warn("Push dispatch temporarily unavailable. Retrying on next message.");
    }
    return;
  }

  throw error;
}
