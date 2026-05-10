import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

const TOKEN_WAIT_TIMEOUT_MS = 15000;
const PUSH_DISPATCH_ENABLED_IN_DEV = import.meta.env.VITE_ENABLE_PUSH_DISPATCH_IN_DEV !== "false";
const CAN_DISPATCH_PUSH = !import.meta.env.DEV || PUSH_DISPATCH_ENABLED_IN_DEV;
const PUSH_DEBUG_ENABLED = import.meta.env.DEV || import.meta.env.MODE === "test";

let hasLoggedPushDispatchDevSkip = false;
let hasLoggedPushFunctionMissing = false;
let lastPushDispatchFetchErrorAt = 0;

type PushDeviceInfo = {
  app_build: string | null;
  app_version: string | null;
  is_native: boolean;
  locale: string | null;
  platform: "ios" | "android" | "web";
  screen_scale: number | null;
  screen_size: string | null;
  timezone: string | null;
  user_agent: string | null;
};

type PushTokenRow = {
  token: string;
  platform: "ios" | "android" | "web";
  device_info: PushDeviceInfo;
};

export type PushRegistrationResult =
  | { status: "granted"; token: string; platform: "ios" | "android" }
  | { status: "denied"; reason: "permission_denied_or_not_completed" }
  | { status: "unsupported" };

function logPushDebug(message: string, data?: unknown) {
  if (!PUSH_DEBUG_ENABLED) return;
  if (typeof data === "undefined") {
    console.info(`[push] ${message}`);
    return;
  }
  console.info(`[push] ${message}`, data);
}

function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function getPushPlatform(): "ios" | "android" | "web" {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  return "web";
}

async function requestPushPermission() {
  const initial = await PushNotifications.checkPermissions();
  let receive = initial.receive;

  if (receive === "prompt-with-rationale") {
    receive = "prompt";
  }
  logPushDebug("Permission check result", { receive });

  if (receive === "prompt") {
    const requested = await PushNotifications.requestPermissions();
    receive = requested.receive;
    if (receive === "prompt-with-rationale") {
      receive = "prompt";
    }
    logPushDebug("Permission request result", { receive });
  }

  if (receive !== "granted") {
    return "denied" as const;
  }

  return "granted" as const;
}

async function registerForPushToken() {
  return new Promise<string>((resolve, reject) => {
    void (async () => {
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
          logPushDebug("Received APNs/Firebase token from native bridge", {
            length: token.value.length,
          });
          resolve(token.value);
        });

        registrationErrorHandle = await PushNotifications.addListener(
          "registrationError",
          async (error) => {
            window.clearTimeout(timeout);
            await cleanup();
            logPushDebug("Native registration error", error);
            const message =
              typeof error.error === "string"
                ? error.error
                : JSON.stringify(error.error ?? error ?? "Unknown push registration error");
            reject(new Error(message));
          },
        );

        logPushDebug("Starting native push registration");
        await PushNotifications.register();
      } catch (error) {
        window.clearTimeout(timeout);
        await cleanup();
        reject(error);
      }
    })();
  });
}

async function collectPushDeviceInfo(platform: "ios" | "android"): Promise<PushDeviceInfo> {
  let appVersion: string | null = null;
  let appBuild: string | null = null;

  try {
    const appInfo = await App.getInfo();
    appVersion = appInfo.version ?? null;
    appBuild = appInfo.build ?? null;
  } catch {
    // Keep nullable values when app metadata is unavailable.
  }

  const timezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || null : null;
  const locale =
    typeof navigator !== "undefined"
      ? navigator.language || (navigator.languages?.[0] ?? null)
      : null;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || null : null;
  const screenSize =
    typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height}` : null;
  const screenScale = typeof window !== "undefined" ? window.devicePixelRatio : null;

  return {
    app_build: appBuild,
    app_version: appVersion,
    is_native: isNativePlatform(),
    locale,
    platform,
    screen_scale: screenScale,
    screen_size: screenSize,
    timezone,
    user_agent: userAgent,
  };
}

export async function upsertPushToken(row: PushTokenRow) {
  const untypedClient = supabase as unknown as {
    rpc: (
      fn: string,
      args: {
        p_device_info: PushDeviceInfo;
        p_platform: "ios" | "android" | "web";
        p_token: string;
      },
    ) => Promise<{ error: { message: string } | null }>;
  };

  const { error } = await untypedClient.rpc("register_push_token", {
    p_device_info: row.device_info,
    p_platform: row.platform,
    p_token: row.token,
  });
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

  const permissionState = await requestPushPermission();
  if (permissionState === "denied") {
    logPushDebug("Permission denied or not completed");
    return { status: "denied", reason: "permission_denied_or_not_completed" };
  }

  const token = await registerForPushToken();
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new Error("Push registration returned an empty token.");
  }
  const deviceInfo = await collectPushDeviceInfo(platform);

  await upsertPushToken({
    device_info: deviceInfo,
    token: normalizedToken,
    platform,
  });
  logPushDebug("Push token persisted", { platform, userId });

  return { status: "granted", token: normalizedToken, platform };
}

export async function dispatchNewMessagePush(messageId: string) {
  if (!messageId) return;

  if (!CAN_DISPATCH_PUSH) {
    if (!hasLoggedPushDispatchDevSkip) {
      hasLoggedPushDispatchDevSkip = true;
      console.info(
        "Push dispatch skipped in development. Set VITE_ENABLE_PUSH_DISPATCH_IN_DEV=true to re-enable.",
      );
    }
    return;
  }

  const { error } = await supabase.functions.invoke("dispatch-message-push", {
    body: { messageId },
  });
  if (!error) {
    logPushDebug("Push dispatch edge function invoked", { messageId });
    return;
  }

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
