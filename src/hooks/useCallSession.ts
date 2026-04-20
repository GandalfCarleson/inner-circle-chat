import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type CallSession,
  type CallSignalMessage,
  buildSignalBase,
  createSignalChannel,
  sendSignal,
} from "@/lib/calls";

export type CallRole = "caller" | "callee";

export interface ActiveCallDescriptor {
  session: CallSession;
  role: CallRole;
  peerUserId: string;
  peerDisplayName: string;
}

export type CallConnectionPhase =
  | "idle"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "failed";

interface UseCallSessionArgs {
  activeCall: ActiveCallDescriptor | null;
  currentUserId: string | null;
  onRemoteEnd: (reason: "hangup" | "decline" | "connection-failed") => void;
  onFatalError: (message: string) => void;
}

export function useCallSession({
  activeCall,
  currentUserId,
  onRemoteEnd,
  onFatalError,
}: UseCallSessionArgs) {
  const [phase, setPhase] = useState<CallConnectionPhase>("idle");
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeCallRef = useRef<ActiveCallDescriptor | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const startSessionIdRef = useRef<string | null>(null);
  const endSignaledRef = useRef(false);

  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callSessionId = activeCall?.session.id ?? null;
  const callStatus = activeCall?.session.status ?? null;
  const callType = activeCall?.session.type ?? null;

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const stopAndClearStreams = useCallback(() => {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    localStreamRef.current = null;
    setLocalStream(null);

    for (const track of remoteStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    remoteStreamRef.current = null;
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraEnabled(true);
  }, []);

  const cleanupPeer = useCallback(() => {
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onnegotiationneeded = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }

    peerRef.current = null;
    setConnectionState("closed");
    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
  }, []);

  const cleanupSignalChannel = useCallback(async () => {
    if (!signalChannelRef.current) return;
    const channel = signalChannelRef.current;
    signalChannelRef.current = null;
    await channel.unsubscribe();
  }, []);

  const resetAll = useCallback(async () => {
    await cleanupSignalChannel();
    cleanupPeer();
    stopAndClearStreams();
    startSessionIdRef.current = null;
    endSignaledRef.current = false;
    setErrorMessage(null);
    setPhase("idle");
  }, [cleanupPeer, cleanupSignalChannel, stopAndClearStreams]);

  const handleSignal = useCallback(
    async (message: CallSignalMessage) => {
      const active = activeCallRef.current;
      const currentUser = currentUserIdRef.current;
      if (!active || !currentUser) return;
      if (message.call_session_id !== active.session.id) return;
      if (message.from_user_id === currentUser) return;

      if (message.type === "decline") {
        setPhase("ended");
        onRemoteEnd("decline");
        return;
      }

      if (message.type === "hangup") {
        setPhase("ended");
        onRemoteEnd("hangup");
        return;
      }

      const peer = peerRef.current;
      if (!peer) {
        if (message.type === "ice-candidate") {
          pendingCandidatesRef.current.push(message.candidate);
        }
        return;
      }

      const polite = active.role === "callee";

      try {
        if (message.type === "offer" || message.type === "answer") {
          const readyForOffer =
            !makingOfferRef.current &&
            (peer.signalingState === "stable" || isSettingRemoteAnswerPendingRef.current);

          const offerCollision = message.type === "offer" && !readyForOffer;
          ignoreOfferRef.current = !polite && offerCollision;

          if (ignoreOfferRef.current) {
            return;
          }

          isSettingRemoteAnswerPendingRef.current = message.type === "answer";
          await peer.setRemoteDescription(message.description);
          isSettingRemoteAnswerPendingRef.current = false;

          if (message.type === "offer") {
            await peer.setLocalDescription();
            if (!peer.localDescription || !signalChannelRef.current) return;

            await sendSignal(signalChannelRef.current, {
              ...buildSignalBase(active.session.id, currentUser),
              type: "answer",
              description: peer.localDescription.toJSON(),
            });
          }

          while (pendingCandidatesRef.current.length > 0) {
            const candidate = pendingCandidatesRef.current.shift();
            if (!candidate) continue;
            await peer.addIceCandidate(candidate);
          }

          return;
        }

        if (message.type === "ice-candidate") {
          try {
            await peer.addIceCandidate(message.candidate);
          } catch (error) {
            if (!ignoreOfferRef.current) throw error;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to process signaling message";
        setErrorMessage(msg);
        setPhase("failed");
        onFatalError(msg);
      }
    },
    [onFatalError, onRemoteEnd],
  );

  const ensureSignalChannel = useCallback(async () => {
    const active = activeCallRef.current;
    if (!active) return;
    if (signalChannelRef.current) return;

    const channel = createSignalChannel(active.session.id);
    signalChannelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void handleSignal(payload as CallSignalMessage);
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          reject(new Error(`Call signaling subscribe failed (${status})`));
        }
      });
    });
  }, [handleSignal]);

  const startMediaAndPeer = useCallback(async () => {
    const active = activeCallRef.current;
    const currentUser = currentUserIdRef.current;

    if (!active || !currentUser) return;
    if (startSessionIdRef.current === active.session.id) return;

    const wantVideo = active.session.type === "video";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideo,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraEnabled(wantVideo);

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      peerRef.current = peer;
      setConnectionState(peer.connectionState);

      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
      }

      peer.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? []) {
          if (remote.getTracks().some((existingTrack) => existingTrack.id === track.id)) continue;
          remote.addTrack(track);
        }
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate || !signalChannelRef.current) return;
        void sendSignal(signalChannelRef.current, {
          ...buildSignalBase(active.session.id, currentUser),
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        }).catch((error) => {
          console.error("Failed to send ICE candidate", error);
        });
      };

      peer.onnegotiationneeded = async () => {
        const currentActive = activeCallRef.current;
        const channel = signalChannelRef.current;
        const selfUser = currentUserIdRef.current;

        if (!currentActive || !channel || !selfUser) return;
        if (currentActive.session.status !== "accepted") return;

        try {
          makingOfferRef.current = true;
          await peer.setLocalDescription();
          if (!peer.localDescription) return;

          await sendSignal(channel, {
            ...buildSignalBase(currentActive.session.id, selfUser),
            type: "offer",
            description: peer.localDescription.toJSON(),
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Failed to create offer";
          setErrorMessage(msg);
          setPhase("failed");
          onFatalError(msg);
        } finally {
          makingOfferRef.current = false;
        }
      };

      peer.onconnectionstatechange = () => {
        setConnectionState(peer.connectionState);

        if (peer.connectionState === "connected") {
          setPhase("connected");
        }

        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setPhase("failed");
          if (!endSignaledRef.current) {
            endSignaledRef.current = true;
            onRemoteEnd("connection-failed");
          }
        }
      };

      while (pendingCandidatesRef.current.length > 0) {
        const candidate = pendingCandidatesRef.current.shift();
        if (!candidate) continue;
        await peer.addIceCandidate(candidate);
      }

      startSessionIdRef.current = active.session.id;
      setPhase("connecting");
    } catch (error) {
      const msg =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone/camera access was denied."
          : error instanceof Error
            ? error.message
            : "Unable to start media for this call.";

      setErrorMessage(msg);
      setPhase("failed");
      onFatalError(msg);
    }
  }, [onFatalError, onRemoteEnd]);

  useEffect(() => {
    if (!callSessionId || !currentUserId) {
      void resetAll();
      return;
    }

    setErrorMessage(null);
    endSignaledRef.current = false;
    setPhase(callStatus === "ringing" ? "ringing" : "connecting");

    void ensureSignalChannel().catch((error) => {
      const msg = error instanceof Error ? error.message : "Failed to connect call signaling";
      setErrorMessage(msg);
      setPhase("failed");
      onFatalError(msg);
    });

    return () => {
      void resetAll();
    };
  }, [callSessionId, callStatus, currentUserId, ensureSignalChannel, onFatalError, resetAll]);

  useEffect(() => {
    if (!callSessionId || !currentUserId) return;
    if (callStatus !== "accepted") return;

    void startMediaAndPeer();
  }, [callSessionId, callStatus, callType, currentUserId, startMediaAndPeer]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextMuted = !isMuted;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) return;

    const nextEnabled = !isCameraEnabled;
    for (const track of videoTracks) {
      track.enabled = nextEnabled;
    }
    setIsCameraEnabled(nextEnabled);
  }, [isCameraEnabled]);

  const sendControlSignal = useCallback(async (type: "hangup" | "decline", reason?: string) => {
    const active = activeCallRef.current;
    const currentUser = currentUserIdRef.current;
    const channel = signalChannelRef.current;
    if (!active || !currentUser || !channel) return;

    await sendSignal(channel, {
      ...buildSignalBase(active.session.id, currentUser),
      type,
      reason,
    });
  }, []);

  return {
    phase,
    connectionState,
    localStream,
    remoteStream,
    isMuted,
    isCameraEnabled,
    errorMessage,
    toggleMute,
    toggleCamera,
    sendControlSignal,
  };
}
