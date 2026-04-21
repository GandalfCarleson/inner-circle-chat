import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const GLOBAL_PRESENCE_CHANNEL = "void:presence:global";
const PRESENCE_HEARTBEAT_MS = 45_000;

export interface PresenceMember {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  last_active_at: string;
}

interface PresenceContextValue {
  onlineByUserId: Record<string, PresenceMember>;
  lastSeenByUserId: Record<string, string>;
  isUserOnline: (userId?: string | null) => boolean;
  getLastSeenAt: (userId?: string | null) => string | null;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

interface PresenceMetaShape {
  metas?: unknown;
}

function parsePresenceState(rawState: Record<string, unknown>): Record<string, PresenceMember> {
  const next: Record<string, PresenceMember> = {};

  for (const value of Object.values(rawState)) {
    const metas = Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? (((value as PresenceMetaShape).metas as unknown[] | undefined) ?? [])
        : [];

    for (const meta of metas) {
      if (!meta || typeof meta !== "object") continue;
      const candidate = meta as Partial<PresenceMember>;
      if (!candidate.user_id || typeof candidate.user_id !== "string") continue;

      const normalized: PresenceMember = {
        user_id: candidate.user_id,
        username: typeof candidate.username === "string" ? candidate.username : null,
        display_name: typeof candidate.display_name === "string" ? candidate.display_name : null,
        avatar_url: typeof candidate.avatar_url === "string" ? candidate.avatar_url : null,
        last_active_at:
          typeof candidate.last_active_at === "string"
            ? candidate.last_active_at
            : new Date().toISOString(),
      };

      const previous = next[normalized.user_id];
      if (!previous) {
        next[normalized.user_id] = normalized;
        continue;
      }

      if (
        new Date(normalized.last_active_at).getTime() > new Date(previous.last_active_at).getTime()
      ) {
        next[normalized.user_id] = normalized;
      }
    }
  }

  return next;
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [onlineByUserId, setOnlineByUserId] = useState<Record<string, PresenceMember>>({});
  const [lastSeenByUserId, setLastSeenByUserId] = useState<Record<string, string>>({});
  const previousOnlineIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setOnlineByUserId({});
      previousOnlineIdsRef.current = new Set();
      return;
    }

    let isActive = true;
    let heartbeatTimer: number | undefined;

    const buildSelfPresence = (): PresenceMember => ({
      user_id: user.id,
      username: profile?.username ?? null,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      last_active_at: new Date().toISOString(),
    });

    const channel = supabase.channel(GLOBAL_PRESENCE_CHANNEL, {
      config: {
        presence: { key: user.id },
      },
    });

    const syncPresence = () => {
      if (!isActive) return;
      const snapshot = parsePresenceState(channel.presenceState() as Record<string, unknown>);
      const nowIso = new Date().toISOString();
      const currentOnlineIds = new Set(Object.keys(snapshot));

      setLastSeenByUserId((current) => {
        const next = { ...current };

        for (const userId of previousOnlineIdsRef.current) {
          if (!currentOnlineIds.has(userId)) {
            next[userId] = nowIso;
          }
        }

        for (const [userId, member] of Object.entries(snapshot)) {
          next[userId] = member.last_active_at;
        }

        return next;
      });

      previousOnlineIdsRef.current = currentOnlineIds;
      setOnlineByUserId(snapshot);
    };

    channel.on("presence", { event: "sync" }, syncPresence);
    channel.on("presence", { event: "join" }, syncPresence);
    channel.on("presence", { event: "leave" }, syncPresence);

    channel.subscribe(async (status) => {
      if (!isActive || status !== "SUBSCRIBED") return;

      await channel.track(buildSelfPresence());
      heartbeatTimer = window.setInterval(() => {
        void channel.track(buildSelfPresence());
      }, PRESENCE_HEARTBEAT_MS);
    });

    return () => {
      isActive = false;
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [profile?.avatar_url, profile?.display_name, profile?.username, user]);

  const isUserOnline = useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return Boolean(onlineByUserId[userId]);
    },
    [onlineByUserId],
  );

  const getLastSeenAt = useCallback(
    (userId?: string | null) => {
      if (!userId) return null;
      if (onlineByUserId[userId]?.last_active_at) return onlineByUserId[userId].last_active_at;
      return lastSeenByUserId[userId] ?? null;
    },
    [lastSeenByUserId, onlineByUserId],
  );

  const value = useMemo<PresenceContextValue>(
    () => ({
      onlineByUserId,
      lastSeenByUserId,
      isUserOnline,
      getLastSeenAt,
    }),
    [getLastSeenAt, isUserOnline, lastSeenByUserId, onlineByUserId],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (!context) throw new Error("usePresence must be used inside <PresenceProvider>");
  return context;
}
