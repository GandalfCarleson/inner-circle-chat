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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  CALLING_ENABLED,
  type CallSession,
  type CallType,
  createCallSession,
  getCallPeerProfile,
  isTerminalCallStatus,
  listRingingCallSessionsForCallee,
  setCallSessionStatus,
} from "@/lib/calls";
import {
  useCallSession,
  type ActiveCallDescriptor,
  type CallConnectionPhase,
} from "@/hooks/useCallSession";
import { supabase } from "@/integrations/supabase/client";

const OUTGOING_RING_TIMEOUT_MS = 30_000;
const CALL_TIMING_DEBUG = import.meta.env.DEV || import.meta.env.MODE === "test";

function nowPerfMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logCallTiming(label: string, details?: Record<string, unknown>) {
  if (!CALL_TIMING_DEBUG) return;
  if (details) {
    console.info(`[call-timing][context] ${label}`, details);
    return;
  }
  console.info(`[call-timing][context] ${label}`);
}

interface StartOutgoingCallArgs {
  conversationId: string;
  calleeUserId: string;
  calleeDisplayName: string;
  type: CallType;
}

interface CallContextValue {
  activeCall: ActiveCallDescriptor | null;
  incomingCallVisible: boolean;
  isBusy: boolean;
  phase: CallConnectionPhase;
  connectionState: RTCPeerConnectionState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteVideoTrackCount: number;
  isMuted: boolean;
  isCameraEnabled: boolean;
  errorMessage: string | null;
  startOutgoingCall: (args: StartOutgoingCallArgs) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  declineIncomingCall: () => Promise<void>;
  hangupActiveCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function toDisplayName(
  profile: { username: string; display_name: string | null } | null,
  fallback: string,
) {
  const candidate = profile?.display_name?.trim() || profile?.username?.trim();
  return candidate && candidate.length > 0 ? candidate : fallback;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCallDescriptor | null>(null);
  const [incomingCallVisible, setIncomingCallVisible] = useState(false);

  const activeCallRef = useRef<ActiveCallDescriptor | null>(null);
  const userIdRef = useRef<string | null>(null);
  const silencedTerminalSessionIdsRef = useRef<Set<string>>(new Set());
  const outgoingCallPressAtRef = useRef<number | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  const clearCallState = useCallback(() => {
    setIncomingCallVisible(false);
    setActiveCall(null);
    outgoingCallPressAtRef.current = null;
  }, []);

  const recordTerminalSilence = useCallback((callSessionId: string) => {
    silencedTerminalSessionIdsRef.current.add(callSessionId);
  }, []);

  const presentIncomingCall = useCallback(async (session: CallSession) => {
    if (session.status !== "ringing") return;

    const currentUserId = userIdRef.current;
    if (!currentUserId) return;

    const current = activeCallRef.current;

    if (current && current.session.id !== session.id) {
      try {
        await setCallSessionStatus({
          callSessionId: session.id,
          participantUserId: currentUserId,
          status: "declined",
        });
      } catch (error) {
        console.error("Failed to auto-decline incoming call while busy", error);
      }
      return;
    }

    if (current && current.session.id === session.id) {
      setActiveCall({ ...current, session });
      setIncomingCallVisible(true);
      return;
    }

    const approxServerToUiMs = Date.now() - Date.parse(session.created_at);
    logCallTiming("incoming-ui-visible", {
      approx_server_to_ui_ms: Number.isFinite(approxServerToUiMs) ? approxServerToUiMs : null,
      session_id: session.id,
    });

    setActiveCall({
      session,
      role: "callee",
      peerUserId: session.caller_user_id,
      peerDisplayName: "Unknown",
    });
    setIncomingCallVisible(true);

    try {
      const profile = await getCallPeerProfile(session.caller_user_id);
      const peerDisplayName = toDisplayName(profile, "Unknown");
      const current = activeCallRef.current;
      if (!current || current.session.id !== session.id) return;
      setActiveCall({ ...current, peerDisplayName });
    } catch (error) {
      console.error("Failed to resolve caller profile", error);
    }
  }, []);

  const applySessionUpdate = useCallback(
    (session: CallSession) => {
      const current = activeCallRef.current;

      if (!current || current.session.id !== session.id) {
        if (session.status === "ringing" && session.callee_user_id === userIdRef.current) {
          void presentIncomingCall(session);
        }
        return;
      }

      if (session.status === "ringing") {
        setActiveCall({ ...current, session });
        if (current.role === "callee") setIncomingCallVisible(true);
        return;
      }

      if (session.status === "accepted") {
        if (current.role === "caller" && outgoingCallPressAtRef.current !== null) {
          logCallTiming("caller-observed-accepted", {
            session_id: session.id,
            to_accepted_ms: Math.round(nowPerfMs() - outgoingCallPressAtRef.current),
          });
        }
        setIncomingCallVisible(false);
        setActiveCall({ ...current, session });
        return;
      }

      if (isTerminalCallStatus(session.status)) {
        const isSilenced = silencedTerminalSessionIdsRef.current.delete(session.id);

        if (!isSilenced) {
          if (session.status === "declined" && current.role === "caller") {
            toast.message(`${current.peerDisplayName} declined the call.`);
          } else if (session.status === "missed" && current.role === "caller") {
            toast.message("No answer.");
          } else if (session.status === "ended") {
            toast.message("Call ended.");
          }
        }

        clearCallState();
        return;
      }

      setActiveCall({ ...current, session });
    },
    [clearCallState, presentIncomingCall],
  );

  const handleRemoteEnd = useCallback(
    (reason: "hangup" | "decline" | "connection-failed") => {
      const current = activeCallRef.current;
      const currentUserId = userIdRef.current;

      if (currentUserId && current && reason === "connection-failed") {
        recordTerminalSilence(current.session.id);
        void setCallSessionStatus({
          callSessionId: current.session.id,
          participantUserId: currentUserId,
          status: "ended",
        }).catch((error) => {
          console.error("Failed to mark connection-failed call as ended", error);
        });
      }

      if (current) {
        if (reason === "decline") {
          toast.message(`${current.peerDisplayName} declined the call.`);
        } else if (reason === "connection-failed") {
          toast.error("Call connection failed.");
        } else {
          toast.message("Call ended.");
        }
      }

      clearCallState();
    },
    [clearCallState, recordTerminalSilence],
  );

  const handleFatalError = useCallback(
    (message: string) => {
      const current = activeCallRef.current;
      const currentUserId = userIdRef.current;

      if (current && currentUserId) {
        recordTerminalSilence(current.session.id);
        void setCallSessionStatus({
          callSessionId: current.session.id,
          participantUserId: currentUserId,
          status: "ended",
        }).catch((error) => {
          console.error("Failed to end call after fatal error", error);
        });
      }

      toast.error(message);
      clearCallState();
    },
    [clearCallState, recordTerminalSilence],
  );

  const {
    phase,
    connectionState,
    localStream,
    remoteStream,
    remoteVideoTrackCount,
    isMuted,
    isCameraEnabled,
    errorMessage,
    toggleMute,
    toggleCamera,
    sendControlSignal,
    markAcceptStart,
  } = useCallSession({
    activeCall,
    currentUserId: user?.id ?? null,
    onRemoteEnd: handleRemoteEnd,
    onFatalError: handleFatalError,
  });

  const startOutgoingCall = useCallback(
    async ({ conversationId, calleeUserId, calleeDisplayName, type }: StartOutgoingCallArgs) => {
      if (!CALLING_ENABLED) {
        throw new Error("Calling is disabled for this build.");
      }

      if (!user?.id) {
        throw new Error("You must be signed in to start a call.");
      }

      if (activeCallRef.current) {
        throw new Error("Finish your current call before starting another one.");
      }

      const pressedAt = nowPerfMs();
      outgoingCallPressAtRef.current = pressedAt;
      logCallTiming("call-button-pressed", {
        callee_user_id: calleeUserId,
        type,
      });

      const session = await createCallSession({
        conversationId,
        callerUserId: user.id,
        calleeUserId,
        type,
      });
      logCallTiming("call-session-created", {
        session_id: session.id,
        to_session_created_ms: Math.round(nowPerfMs() - pressedAt),
      });

      setIncomingCallVisible(false);
      setActiveCall({
        session,
        role: "caller",
        peerUserId: calleeUserId,
        peerDisplayName: calleeDisplayName,
      });
    },
    [user?.id],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!CALLING_ENABLED) return;

    const current = activeCallRef.current;
    const currentUserId = userIdRef.current;

    if (!current || !currentUserId) return;
    if (current.role !== "callee" || current.session.status !== "ringing") return;

    markAcceptStart();
    logCallTiming("accept-tapped", {
      session_id: current.session.id,
    });

    setIncomingCallVisible(false);
    setActiveCall({
      ...current,
      session: {
        ...current.session,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      },
    });

    try {
      await setCallSessionStatus({
        callSessionId: current.session.id,
        participantUserId: currentUserId,
        status: "accepted",
      });
      logCallTiming("accept-persisted", {
        session_id: current.session.id,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to persist accepted call session.";
      toast.error(message);
      clearCallState();
    }
  }, [clearCallState, markAcceptStart]);

  const declineIncomingCall = useCallback(async () => {
    if (!CALLING_ENABLED) return;

    const current = activeCallRef.current;
    const currentUserId = userIdRef.current;

    if (!current || !currentUserId) return;
    if (current.role !== "callee" || current.session.status !== "ringing") return;

    recordTerminalSilence(current.session.id);

    try {
      await sendControlSignal("decline", "declined");
    } catch (error) {
      console.error("Failed to send decline signal", error);
    }

    try {
      await setCallSessionStatus({
        callSessionId: current.session.id,
        participantUserId: currentUserId,
        status: "declined",
      });
    } catch (error) {
      console.error("Failed to persist declined call", error);
    }

    clearCallState();
  }, [clearCallState, recordTerminalSilence, sendControlSignal]);

  const hangupActiveCall = useCallback(async () => {
    if (!CALLING_ENABLED) return;

    const current = activeCallRef.current;
    const currentUserId = userIdRef.current;

    if (!current || !currentUserId) return;

    const nextStatus =
      current.session.status === "ringing" && current.role === "callee" ? "declined" : "ended";
    const signalType = nextStatus === "declined" ? "decline" : "hangup";

    recordTerminalSilence(current.session.id);

    try {
      await sendControlSignal(signalType, "local-end");
    } catch (error) {
      console.error("Failed to send hangup/decline control signal", error);
    }

    try {
      await setCallSessionStatus({
        callSessionId: current.session.id,
        participantUserId: currentUserId,
        status: nextStatus,
      });
    } catch (error) {
      console.error("Failed to persist ended call", error);
    }

    clearCallState();
  }, [clearCallState, recordTerminalSilence, sendControlSignal]);

  useEffect(() => {
    if (!CALLING_ENABLED) {
      clearCallState();
      return;
    }

    const currentUserId = user?.id;

    if (!currentUserId) {
      clearCallState();
      return;
    }

    let active = true;

    const calleeChannel = supabase
      .channel(`call-sessions-callee:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_sessions",
          filter: `callee_user_id=eq.${currentUserId}`,
        },
        ({ new: next }) => {
          if (!active) return;
          const session = next as CallSession;
          if (session.status === "ringing") {
            void presentIncomingCall(session);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_sessions",
          filter: `callee_user_id=eq.${currentUserId}`,
        },
        ({ new: next }) => {
          if (!active) return;
          applySessionUpdate(next as CallSession);
        },
      )
      .subscribe();

    const callerChannel = supabase
      .channel(`call-sessions-caller:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_sessions",
          filter: `caller_user_id=eq.${currentUserId}`,
        },
        ({ new: next }) => {
          if (!active) return;
          applySessionUpdate(next as CallSession);
        },
      )
      .subscribe();

    void (async () => {
      try {
        const sessions = await listRingingCallSessionsForCallee(currentUserId, 3);
        if (!active || sessions.length === 0) return;

        await presentIncomingCall(sessions[0]);

        for (const stale of sessions.slice(1)) {
          await setCallSessionStatus({
            callSessionId: stale.id,
            participantUserId: currentUserId,
            status: "declined",
          });
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        console.error("Failed to hydrate pending incoming calls:", message);
      }
    })();

    return () => {
      active = false;
      void supabase.removeChannel(calleeChannel);
      void supabase.removeChannel(callerChannel);
    };
  }, [applySessionUpdate, clearCallState, presentIncomingCall, user?.id]);

  useEffect(() => {
    if (!CALLING_ENABLED) return;
    if (!activeCall || activeCall.role !== "caller" || activeCall.session.status !== "ringing") {
      return;
    }

    const timer = window.setTimeout(() => {
      const current = activeCallRef.current;
      const currentUserId = userIdRef.current;

      if (!current || !currentUserId) return;
      if (current.session.id !== activeCall.session.id) return;
      if (current.role !== "caller" || current.session.status !== "ringing") return;

      recordTerminalSilence(current.session.id);

      void setCallSessionStatus({
        callSessionId: current.session.id,
        participantUserId: currentUserId,
        status: "missed",
      }).catch((error) => {
        console.error("Failed to mark unanswered call as missed", error);
      });

      toast.message("No answer.");
      clearCallState();
    }, OUTGOING_RING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeCall, clearCallState, recordTerminalSilence]);

  const value = useMemo<CallContextValue>(
    () => ({
      activeCall,
      incomingCallVisible,
      isBusy: !!activeCall,
      phase,
      connectionState,
      localStream,
      remoteStream,
      remoteVideoTrackCount,
      isMuted,
      isCameraEnabled,
      errorMessage,
      startOutgoingCall,
      acceptIncomingCall,
      declineIncomingCall,
      hangupActiveCall,
      toggleMute,
      toggleCamera,
    }),
    [
      activeCall,
      incomingCallVisible,
      phase,
      connectionState,
      localStream,
      remoteStream,
      remoteVideoTrackCount,
      isMuted,
      isCameraEnabled,
      errorMessage,
      startOutgoingCall,
      acceptIncomingCall,
      declineIncomingCall,
      hangupActiveCall,
      toggleMute,
      toggleCamera,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCallManager() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error("useCallManager must be used inside <CallProvider>");
  }

  return context;
}
