import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
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
  const registeredForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!CAN_REGISTER_PUSH) return;
    if (!user || !isNativeApp()) return;
    if (registeredForUserRef.current === user.id) return;
    registeredForUserRef.current = user.id;

    void registerAndStorePushToken(user.id).catch((error) => {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Push registration failed", message);
    });
  }, [user]);

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
        actionHandle = await PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
          const conversationId = readConversationIdFromNotification(event.notification);
          if (!conversationId) return;
          router.navigate({ to: "/chat/$id", params: { id: conversationId } });
        });

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
