import { useEffect, useMemo, useRef } from "react";
import { Camera, CameraOff, Mic, MicOff, PhoneOff } from "lucide-react";
import type { ActiveCallDescriptor, CallConnectionPhase } from "@/hooks/useCallSession";

interface VideoCallScreenProps {
  activeCall: ActiveCallDescriptor;
  phase: CallConnectionPhase;
  connectionState: RTCPeerConnectionState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteVideoTrackCount: number;
  isMuted: boolean;
  isCameraEnabled: boolean;
  errorMessage: string | null;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onHangup: () => void;
}

function getStatusText(
  phase: CallConnectionPhase,
  connectionState: RTCPeerConnectionState,
  errorMessage: string | null,
) {
  if (errorMessage) return errorMessage;
  if (phase === "ringing") return "Ringing...";
  if (phase === "connecting") return "Connecting...";
  if (phase === "connected") return "Connected";
  if (phase === "failed") return "Connection failed";
  if (phase === "ended") return "Call ended";
  if (connectionState === "connecting") return "Connecting...";
  return "Preparing video call...";
}

export function VideoCallScreen({
  activeCall,
  phase,
  connectionState,
  localStream,
  remoteStream,
  remoteVideoTrackCount,
  isMuted,
  isCameraEnabled,
  errorMessage,
  onToggleMute,
  onToggleCamera,
  onHangup,
}: VideoCallScreenProps) {
  const callRole = activeCall.role;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = localVideoRef.current;
    if (!element) return;

    element.srcObject = localStream;
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      console.info("[webrtc-ui] local video srcObject assigned", {
        role: callRole,
        stream_id: localStream?.id ?? null,
        track_ids: localStream?.getTracks().map((track) => track.id) ?? [],
      });
    }
    if (localStream) {
      void element.play().catch(() => {
        // iOS WebView can delay autoplay until user interaction.
      });
    }

    return () => {
      element.srcObject = null;
    };
  }, [callRole, localStream]);

  useEffect(() => {
    const element = remoteVideoRef.current;
    if (!element) return;

    element.srcObject = remoteStream;
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      console.info("[webrtc-ui] remote video srcObject assigned", {
        role: callRole,
        stream_id: remoteStream?.id ?? null,
        track_ids: remoteStream?.getTracks().map((track) => track.id) ?? [],
        video_track_count: remoteStream?.getVideoTracks().length ?? 0,
      });
    }
    if (remoteStream) {
      void element.play().catch(() => {
        // Fallback stays visible until playback can start.
      });
    }

    return () => {
      element.srcObject = null;
    };
  }, [callRole, remoteStream]);

  const hasRemoteVideo = useMemo(() => remoteVideoTrackCount > 0, [remoteVideoTrackCount]);

  return (
    <div className="safe-inset fixed inset-0 z-[80] overflow-hidden bg-black">
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          hasRemoteVideo ? "opacity-100" : "opacity-0"
        }`}
      />
      {!hasRemoteVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(241,137,69,0.2),_transparent_52%),linear-gradient(180deg,#050505,#0b0b0b)]">
          <span className="text-[48px] font-semibold uppercase tracking-[-0.06em] text-white/78">
            {activeCall.peerDisplayName.slice(0, 1)}
          </span>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-b from-black/52 via-transparent to-black/68" />

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="pt-5 text-center">
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/54">
            video call
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-white">
            {activeCall.peerDisplayName}
          </h2>
          <p className="mt-1 text-sm text-white/74">
            {getStatusText(phase, connectionState, errorMessage)}
          </p>
        </div>

        <div className="pointer-events-none absolute right-4 top-24 z-20 h-36 w-24 overflow-hidden rounded-2xl border border-white/18 bg-black/55 shadow-[0_12px_28px_rgba(0,0,0,0.4)] sm:h-44 sm:w-28">
          {localStream && isCameraEnabled ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-white/66">
              Camera off
            </div>
          )}
        </div>

        <div className="safe-bottom relative z-10 flex items-center justify-center gap-4 pb-4">
          <button
            onClick={onToggleMute}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
              isMuted
                ? "border-orange-300/30 bg-orange-500/20 text-orange-100"
                : "border-white/22 bg-black/35 text-white hover:bg-black/48"
            }`}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            onClick={onToggleCamera}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
              isCameraEnabled
                ? "border-white/22 bg-black/35 text-white hover:bg-black/48"
                : "border-orange-300/30 bg-orange-500/20 text-orange-100"
            }`}
            aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          >
            {isCameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
          </button>

          <button
            onClick={onHangup}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-red-300/25 bg-red-500/28 text-red-100 transition-colors hover:bg-red-500/36"
            aria-label="Hang up"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
