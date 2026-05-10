import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { useAuth } from "@/contexts/AuthContext";
import { isNativeApp } from "@/lib/native";
import { registerAndStorePushToken } from "@/lib/push";

const PUSH_ENABLED_IN_DEV = import.meta.env.VITE_ENABLE_PUSH_IN_DEV !== "false";
const CAN_REGISTER_PUSH = !import.meta.env.DEV || PUSH_ENABLED_IN_DEV;

function readConversationIdFromNotification(
  notification: { data?: Record<string, unknown> | null } | null | undefined,
) {
  if (!notification?.data) return null;
  const value = notification.data.conversation_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const registrationCompletedForUserRef = useRef<string | null>(null);
  const registrationInFlightRef = useRef(false);

  const attemptPushRegistration = useCallback(async () => {
    if (!CAN_REGISTER_PUSH) return;
    if (!user || !isNativeApp()) return;
    if (registrationCompletedForUserRef.current === user.id) return;
    if (registrationInFlightRef.current) return;

    registrationInFlightRef.current = true;
    try {
      const result = await registerAndStorePushToken(user.id);
      if (result.status === "granted") {
        registrationCompletedForUserRef.current = user.id;
      }
      if ((import.meta.env.DEV || import.meta.env.MODE === "test") && result.status !== "granted") {
        console.info("[push] Registration not completed", result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Push registration failed", message);
    } finally {
      registrationInFlightRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      registrationCompletedForUserRef.current = null;
      registrationInFlightRef.current = false;
      return;
    }
    void attemptPushRegistration();
  }, [attemptPushRegistration, user]);

  useEffect(() => {
    if (!CAN_REGISTER_PUSH) return;
    if (!isNativeApp()) return;

    let handle:
      | {
          remove: () => Promise<void>;
        }
      | undefined;

    void App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void attemptPushRegistration();
    })
      .then((listener) => {
        handle = listener;
      })
      .catch((error) => {
        console.error("Failed to attach appStateChange listener for push retry", error);
      });

    return () => {
      void handle?.remove();
    };
  }, [attemptPushRegistration]);

  useEffect(() => {
    if (!CAN_REGISTER_PUSH) return;
    if (!isNativeApp()) return;

    let active = true;
    let actionHandle:
      | {
          remove: () => Promise<void>;
        }
      | undefined;
    let receivedHandle:
      | {
          remove: () => Promise<void>;
        }
      | undefined;

    void (async () => {
      try {
        actionHandle = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (event) => {
            const conversationId = readConversationIdFromNotification(event.notification);
            if (!conversationId) return;
            router.navigate({ to: "/chat/$id", params: { id: conversationId } });
          },
        );

        receivedHandle = await PushNotifications.addListener("pushNotificationReceived", () => {
          // Native foreground presentation is configured in capacitor.config.ts.
        });
      } catch (error) {
        if (!active) return;
        console.error("Failed to subscribe to push notification listeners", error);
      }
    })();

    return () => {
      active = false;
      void actionHandle?.remove();
      void receivedHandle?.remove();
    };
  }, [router]);
}
