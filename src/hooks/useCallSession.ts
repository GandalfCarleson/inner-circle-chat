import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type CallSession,
  type CallSignalMessage,
  buildSignalBase,
  createSignalChannel,
  sendSignal,
} from "@/lib/calls";

const CALL_TIMING_DEBUG = import.meta.env.DEV || import.meta.env.MODE === "test";

function nowPerfMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function parseIceServersFromEnv(): RTCIceServer[] | null {
  const raw = import.meta.env.VITE_WEBRTC_ICE_SERVERS_JSON;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    const servers = parsed.filter(
      (entry): entry is RTCIceServer =>
        !!entry && typeof entry === "object" && "urls" in (entry as Record<string, unknown>),
    );

    return servers.length > 0 ? servers : null;
  } catch {
    return null;
  }
}

function getIceServers(): RTCIceServer[] {
  const fromEnv = parseIceServersFromEnv();
  if (fromEnv) return fromEnv;

  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];
}

function logWebRtcDebug(label: string, details?: Record<string, unknown>) {
  if (!CALL_TIMING_DEBUG) return;
  if (details) {
    console.info(`[webrtc] ${label}`, details);
    return;
  }
  console.info(`[webrtc] ${label}`);
}

type SdpDirection = "sendrecv" | "sendonly" | "recvonly" | "inactive" | "unspecified";

function extractMediaDirection(sdp: string, media: "audio" | "video"): SdpDirection {
  const lines = sdp.split(/\r?\n/);
  let inTargetSection = false;

  for (const line of lines) {
    if (line.startsWith("m=")) {
      inTargetSection = line.startsWith(`m=${media}`);
      continue;
    }

    if (!inTargetSection) continue;
    if (line === "a=sendrecv") return "sendrecv";
    if (line === "a=sendonly") return "sendonly";
    if (line === "a=recvonly") return "recvonly";
    if (line === "a=inactive") return "inactive";
  }

  return "unspecified";
}

function summarizeSdp(sdp: string | null | undefined) {
  if (!sdp) {
    return {
      has_audio_mline: false,
      has_video_mline: false,
      audio_direction: "unspecified" as SdpDirection,
      video_direction: "unspecified" as SdpDirection,
      msid_line_count: 0,
    };
  }

  const msidLineCount = sdp.split(/\r?\n/).filter((line) => line.startsWith("a=msid:")).length;
  return {
    has_audio_mline: sdp.includes("m=audio"),
    has_video_mline: sdp.includes("m=video"),
    audio_direction: extractMediaDirection(sdp, "audio"),
    video_direction: extractMediaDirection(sdp, "video"),
    msid_line_count: msidLineCount,
  };
}

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

type MutableRef<T> = {
  current: T;
};

function buildTimingLogger(sessionIdRef: MutableRef<string | null>) {
  return (
    role: CallRole | "unknown",
    label: string,
    sessionStartedAtRef: MutableRef<number>,
    acceptStartedAtRef: MutableRef<number | null>,
    details?: Record<string, unknown>,
  ) => {
    if (!CALL_TIMING_DEBUG) return;

    const sessionId = sessionIdRef.current ?? "none";
    const now = nowPerfMs();
    const sinceSessionMs = Math.round(now - sessionStartedAtRef.current);
    const sinceAcceptMs =
      acceptStartedAtRef.current === null ? null : Math.round(now - acceptStartedAtRef.current);

    const payload = {
      ...details,
      role,
      since_accept_ms: sinceAcceptMs,
      since_session_ms: sinceSessionMs,
    };

    console.info(`[call-timing][${sessionId}] ${label}`, payload);
  };
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
  const [remoteVideoTrackCount, setRemoteVideoTrackCount] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeCallRef = useRef<ActiveCallDescriptor | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const endSignaledRef = useRef(false);

  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingSignalsRef = useRef<CallSignalMessage[]>([]);
  const outboundIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const mediaAcquirePromiseRef = useRef<Promise<void> | null>(null);
  const peerInitPromiseRef = useRef<Promise<void> | null>(null);
  const localTracksAddedRef = useRef(false);

  const loggedMarkersRef = useRef<Set<string>>(new Set());
  const callSessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef(0);
  const acceptStartedAtRef = useRef<number | null>(null);
  const acceptObservedRef = useRef(false);
  const sdpExchangeLoggedRef = useRef(false);
  const remoteMediaLoggedRef = useRef(false);
  const iceConnectedLoggedRef = useRef(false);

  const callSessionId = activeCall?.session.id ?? null;
  const callStatus = activeCall?.session.status ?? null;
  const callRole = activeCall?.role ?? null;

  const logTiming = buildTimingLogger(callSessionIdRef);

  const markTiming = useCallback(
    (label: string, details?: Record<string, unknown>) => {
      const active = activeCallRef.current;
      const role = active?.role ?? "unknown";
      logTiming(role, label, sessionStartedAtRef, acceptStartedAtRef, details);
    },
    [logTiming],
  );

  const markTimingOnce = useCallback(
    (marker: string, label: string, details?: Record<string, unknown>) => {
      if (loggedMarkersRef.current.has(marker)) return;
      loggedMarkersRef.current.add(marker);
      markTiming(label, details);
    },
    [markTiming],
  );

  const markAcceptStart = useCallback(() => {
    if (acceptStartedAtRef.current !== null) return;
    acceptStartedAtRef.current = nowPerfMs();
    markTiming("accept-action", {
      source: "local-user-action",
    });
  }, [markTiming]);

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
    setRemoteVideoTrackCount(0);
    setIsMuted(false);
    setIsCameraEnabled(true);
    localTracksAddedRef.current = false;
  }, []);

  const cleanupPeer = useCallback(() => {
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onnegotiationneeded = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }

    peerRef.current = null;
    setConnectionState("closed");
    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    outboundIceQueueRef.current = [];
    peerInitPromiseRef.current = null;
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
    endSignaledRef.current = false;
    setErrorMessage(null);
    setPhase("idle");
    pendingSignalsRef.current = [];
    mediaAcquirePromiseRef.current = null;

    loggedMarkersRef.current = new Set();
    sessionStartedAtRef.current = 0;
    acceptStartedAtRef.current = null;
    acceptObservedRef.current = false;
    sdpExchangeLoggedRef.current = false;
    remoteMediaLoggedRef.current = false;
    iceConnectedLoggedRef.current = false;
    callSessionIdRef.current = null;
  }, [cleanupPeer, cleanupSignalChannel, stopAndClearStreams]);

  const flushOutboundIceCandidates = useCallback(async () => {
    const active = activeCallRef.current;
    const currentUser = currentUserIdRef.current;
    const channel = signalChannelRef.current;

    if (!active || !currentUser || !channel) return;
    if (outboundIceQueueRef.current.length === 0) return;

    const toSend = [...outboundIceQueueRef.current];
    outboundIceQueueRef.current = [];

    for (const candidate of toSend) {
      try {
        await sendSignal(channel, {
          ...buildSignalBase(active.session.id, currentUser),
          type: "ice-candidate",
          candidate,
        });
      } catch (error) {
        console.error("Failed to send queued ICE candidate", error);
      }
    }

    markTimingOnce("outbound-ice-flush", "ice-candidates-flushed", {
      count: toSend.length,
    });
  }, [markTimingOnce]);

  const sendOffer = useCallback(async () => {
    const peer = peerRef.current;
    const active = activeCallRef.current;
    const channel = signalChannelRef.current;
    const currentUser = currentUserIdRef.current;

    if (!peer || !active || !channel || !currentUser) return;
    if (active.session.status !== "accepted") return;
    if (active.role !== "caller") return;
    if (makingOfferRef.current) return;

    try {
      makingOfferRef.current = true;
      await peer.setLocalDescription();
      if (!peer.localDescription) return;

      await sendSignal(channel, {
        ...buildSignalBase(active.session.id, currentUser),
        type: "offer",
        description: peer.localDescription.toJSON(),
      });
      logWebRtcDebug("offer-local-description", summarizeSdp(peer.localDescription.sdp));

      markTimingOnce("offer-sent", "offer-sent", {
        signaling_state: peer.signalingState,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to create offer";
      setErrorMessage(msg);
      setPhase("failed");
      onFatalError(msg);
    } finally {
      makingOfferRef.current = false;
    }
  }, [markTimingOnce, onFatalError]);

  const processSignal = useCallback(
    async (message: CallSignalMessage) => {
      const active = activeCallRef.current;
      const currentUser = currentUserIdRef.current;
      const peer = peerRef.current;

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

      if (!peer) {
        pendingSignalsRef.current.push(message);
        return;
      }

      const polite = active.role === "callee";

      try {
        if (message.type === "offer" || message.type === "answer") {
          if (
            message.type === "offer" &&
            active.role === "callee" &&
            (active.session.status !== "accepted" || !localTracksAddedRef.current)
          ) {
            pendingSignalsRef.current.push(message);
            return;
          }

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
            markTimingOnce("offer-received", "offer-received", {
              signaling_state: peer.signalingState,
            });
            logWebRtcDebug("offer-remote-description", summarizeSdp(message.description.sdp));

            await peer.setLocalDescription();
            if (!peer.localDescription || !signalChannelRef.current) return;

            await sendSignal(signalChannelRef.current, {
              ...buildSignalBase(active.session.id, currentUser),
              type: "answer",
              description: peer.localDescription.toJSON(),
            });
            logWebRtcDebug("answer-local-description", summarizeSdp(peer.localDescription.sdp));

            markTimingOnce("answer-sent", "answer-sent", {
              signaling_state: peer.signalingState,
            });

            if (!sdpExchangeLoggedRef.current) {
              sdpExchangeLoggedRef.current = true;
              markTiming("sdp-exchange-complete", { side: "callee" });
            }
          }

          if (message.type === "answer") {
            markTimingOnce("answer-received", "answer-received", {
              signaling_state: peer.signalingState,
            });
            logWebRtcDebug("answer-remote-description", summarizeSdp(message.description.sdp));
            if (!sdpExchangeLoggedRef.current) {
              sdpExchangeLoggedRef.current = true;
              markTiming("sdp-exchange-complete", { side: "caller" });
            }
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
            if (ignoreOfferRef.current) return;
            pendingCandidatesRef.current.push(message.candidate);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to process signaling message";
        setErrorMessage(msg);
        setPhase("failed");
        onFatalError(msg);
      }
    },
    [markTiming, markTimingOnce, onFatalError, onRemoteEnd],
  );

  const flushPendingSignals = useCallback(async () => {
    if (!peerRef.current || pendingSignalsRef.current.length === 0) return;

    const pending = [...pendingSignalsRef.current];
    pendingSignalsRef.current = [];

    for (const message of pending) {
      await processSignal(message);
    }
  }, [processSignal]);

  const ensureSignalChannel = useCallback(async () => {
    const active = activeCallRef.current;
    if (!active) return;
    if (signalChannelRef.current) return;

    const channel = createSignalChannel(active.session.id);
    signalChannelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void processSignal(payload as CallSignalMessage);
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          reject(new Error(`Call signaling subscribe failed (${status})`));
        }
      });
    });

    markTimingOnce("signal-channel-subscribed", "signal-channel-subscribed");
    await flushOutboundIceCandidates();
    await flushPendingSignals();
  }, [flushOutboundIceCandidates, flushPendingSignals, markTimingOnce, processSignal]);

  const createPeerIfNeeded = useCallback(async () => {
    if (peerRef.current) return;

    if (peerInitPromiseRef.current) {
      await peerInitPromiseRef.current;
      return;
    }

    peerInitPromiseRef.current = (async () => {
      const active = activeCallRef.current;
      const currentUser = currentUserIdRef.current;
      if (!active || !currentUser) return;

      const remote = remoteStreamRef.current ?? new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      const peer = new RTCPeerConnection({
        iceServers: getIceServers(),
        iceCandidatePoolSize: 10,
      });

      peerRef.current = peer;
      setConnectionState(peer.connectionState);

      markTimingOnce("peer-created", "peer-connection-created", {
        ice_servers_count: getIceServers().length,
      });

      peer.ontrack = (event) => {
        logWebRtcDebug("remote-track-event", {
          stream_ids: event.streams.map((stream) => stream.id),
          track_id: event.track.id,
          track_kind: event.track.kind,
          track_label: event.track.label,
        });

        for (const track of event.streams[0]?.getTracks() ?? []) {
          if (remote.getTracks().some((existingTrack) => existingTrack.id === track.id)) continue;
          remote.addTrack(track);
          setRemoteVideoTrackCount(remote.getVideoTracks().length);

          if (!remoteMediaLoggedRef.current) {
            remoteMediaLoggedRef.current = true;
            markTiming("remote-media-first-track", {
              track_kind: track.kind,
            });
          }
        }
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;

        const candidate = event.candidate.toJSON();
        const activeNow = activeCallRef.current;
        const currentUserNow = currentUserIdRef.current;
        const channelNow = signalChannelRef.current;

        if (!activeNow || !currentUserNow || !channelNow) {
          outboundIceQueueRef.current.push(candidate);
          return;
        }

        void sendSignal(channelNow, {
          ...buildSignalBase(activeNow.session.id, currentUserNow),
          type: "ice-candidate",
          candidate,
        }).catch((error) => {
          console.error("Failed to send ICE candidate", error);
        });
      };

      peer.onnegotiationneeded = () => {
        const currentActive = activeCallRef.current;
        if (!currentActive || currentActive.role !== "caller") return;
        if (currentActive.session.status !== "accepted") return;
        void sendOffer();
      };

      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        if ((state === "connected" || state === "completed") && !iceConnectedLoggedRef.current) {
          iceConnectedLoggedRef.current = true;
          markTiming("ice-connected", {
            ice_connection_state: state,
          });
        }
      };

      peer.onconnectionstatechange = () => {
        setConnectionState(peer.connectionState);

        if (peer.connectionState === "connected") {
          setPhase("connected");
          markTimingOnce("peer-connected", "peer-connection-connected", {
            connection_state: peer.connectionState,
          });
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

      await flushPendingSignals();
    })();

    try {
      await peerInitPromiseRef.current;
    } finally {
      peerInitPromiseRef.current = null;
    }
  }, [flushPendingSignals, markTiming, markTimingOnce, onRemoteEnd, sendOffer]);

  const ensureLocalMedia = useCallback(async () => {
    const active = activeCallRef.current;
    const peer = peerRef.current;
    if (!active || !peer) return;
    if (localTracksAddedRef.current && localStreamRef.current) return;

    if (mediaAcquirePromiseRef.current) {
      await mediaAcquirePromiseRef.current;
      return;
    }

    mediaAcquirePromiseRef.current = (async () => {
      const wantVideo = active.session.type === "video";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideo,
      });
      logWebRtcDebug("local-media-acquired", {
        stream_id: stream.id,
        track_ids: stream.getTracks().map((track) => track.id),
        track_kinds: stream.getTracks().map((track) => track.kind),
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraEnabled(wantVideo);

      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
        logWebRtcDebug("local-track-added", {
          stream_id: stream.id,
          track_id: track.id,
          track_kind: track.kind,
          transceiver_count: peer.getTransceivers().length,
        });
      }

      localTracksAddedRef.current = true;
      markTimingOnce("local-media-acquired", "local-media-acquired", {
        audio_tracks: stream.getAudioTracks().length,
        video_tracks: stream.getVideoTracks().length,
      });
    })();

    try {
      await mediaAcquirePromiseRef.current;
    } finally {
      mediaAcquirePromiseRef.current = null;
    }
  }, [markTimingOnce]);

  const ensurePeerAndMaybeMedia = useCallback(
    async (options: { withLocalMedia: boolean }) => {
      await ensureSignalChannel();
      await createPeerIfNeeded();
      if (options.withLocalMedia) {
        await ensureLocalMedia();
      }
      await flushPendingSignals();
      await flushOutboundIceCandidates();
    },
    [
      createPeerIfNeeded,
      ensureLocalMedia,
      ensureSignalChannel,
      flushOutboundIceCandidates,
      flushPendingSignals,
    ],
  );

  useEffect(() => {
    if (!callSessionId || !currentUserId) {
      void resetAll();
      return;
    }

    if (callSessionIdRef.current !== callSessionId) {
      callSessionIdRef.current = callSessionId;
      sessionStartedAtRef.current = nowPerfMs();
      acceptStartedAtRef.current = null;
      acceptObservedRef.current = false;
      loggedMarkersRef.current = new Set();
      sdpExchangeLoggedRef.current = false;
      remoteMediaLoggedRef.current = false;
      iceConnectedLoggedRef.current = false;
      markTiming("session-active");
    }

    setErrorMessage(null);
    endSignaledRef.current = false;

    void ensureSignalChannel().catch((error) => {
      const msg = error instanceof Error ? error.message : "Failed to connect call signaling";
      setErrorMessage(msg);
      setPhase("failed");
      onFatalError(msg);
    });

    return () => {
      void resetAll();
    };
  }, [callSessionId, currentUserId, ensureSignalChannel, markTiming, onFatalError, resetAll]);

  useEffect(() => {
    if (!callSessionId || !currentUserId || !callStatus || !callRole) return;

    if (callStatus === "ringing") {
      setPhase("ringing");
      if (callRole === "caller") {
        void ensurePeerAndMaybeMedia({ withLocalMedia: true }).catch((error) => {
          const msg =
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Microphone/camera access was denied."
              : error instanceof Error
                ? error.message
                : "Unable to prepare call media.";
          setErrorMessage(msg);
          setPhase("failed");
          onFatalError(msg);
        });
      } else {
        void ensurePeerAndMaybeMedia({ withLocalMedia: false }).catch((error) => {
          const msg = error instanceof Error ? error.message : "Unable to prepare call signaling.";
          setErrorMessage(msg);
          setPhase("failed");
          onFatalError(msg);
        });
      }
      return;
    }

    if (callStatus === "accepted") {
      if (!acceptObservedRef.current) {
        acceptObservedRef.current = true;
        if (acceptStartedAtRef.current === null) {
          acceptStartedAtRef.current = nowPerfMs();
        }
        markTiming("accepted-observed", {
          source: "session-status",
        });
      }

      setPhase("connecting");
      void ensurePeerAndMaybeMedia({ withLocalMedia: true })
        .then(async () => {
          if (callRole === "caller") {
            await sendOffer();
          }
        })
        .catch((error) => {
          const msg =
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Microphone/camera access was denied."
              : error instanceof Error
                ? error.message
                : "Unable to start media for this call.";

          setErrorMessage(msg);
          setPhase("failed");
          onFatalError(msg);
        });
      return;
    }

    if (callStatus === "declined" || callStatus === "ended" || callStatus === "missed") {
      setPhase("ended");
    }
  }, [
    callRole,
    callSessionId,
    callStatus,
    currentUserId,
    ensurePeerAndMaybeMedia,
    markTiming,
    onFatalError,
    sendOffer,
  ]);

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
    remoteVideoTrackCount,
    isMuted,
    isCameraEnabled,
    errorMessage,
    toggleMute,
    toggleCamera,
    sendControlSignal,
    markAcceptStart,
  };
}
