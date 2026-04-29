import { useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import type { ActiveCallDescriptor, CallConnectionPhase } from "@/hooks/useCallSession";

interface CallScreenProps {
  activeCall: ActiveCallDescriptor;
  phase: CallConnectionPhase;
  connectionState: RTCPeerConnectionState;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  errorMessage: string | null;
  onToggleMute: () => void;
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
  return "Preparing call...";
}

export function CallScreen({
  activeCall,
  phase,
  connectionState,
  remoteStream,
  isMuted,
  errorMessage,
  onToggleMute,
  onHangup,
}: CallScreenProps) {
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = remoteAudioRef.current;
    if (!element) return;

    element.srcObject = remoteStream;
    if (remoteStream) {
      void element.play().catch(() => {
        // Autoplay can fail on some WebView states. User interaction during call controls unlocks it.
      });
    }

    return () => {
      element.srcObject = null;
    };
  }, [remoteStream]);

  return (
    <div className="safe-inset fixed inset-0 z-[80] flex flex-col justify-between bg-[radial-gradient(circle_at_top,_rgba(241,137,69,0.16),_transparent_45%),linear-gradient(180deg,#050505,#0a0a0a)]">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="pt-5 text-center">
        <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/48">
          {activeCall.session.type} call
        </p>
        <h2 className="mt-2 text-[32px] font-semibold tracking-[-0.03em] text-foreground">
          {activeCall.peerDisplayName}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {getStatusText(phase, connectionState, errorMessage)}
        </p>
      </div>

      <div className="mx-auto mt-8 flex h-44 w-44 items-center justify-center rounded-full border border-white/12 bg-white/[0.03] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
        <span className="text-6xl font-semibold uppercase tracking-[-0.06em] text-white/76">
          {activeCall.peerDisplayName.slice(0, 1)}
        </span>
      </div>

      <div className="safe-bottom mt-8 flex items-center justify-center gap-4 pb-4">
        <button
          onClick={onToggleMute}
          className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
            isMuted
              ? "border-orange-300/30 bg-orange-500/20 text-orange-100"
              : "border-white/14 bg-white/[0.06] text-foreground hover:bg-white/[0.1]"
          }`}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
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
  );
}
