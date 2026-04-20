import { Phone, PhoneOff, Video } from "lucide-react";
import type { CallType } from "@/lib/calls";

interface IncomingCallModalProps {
  open: boolean;
  callerName: string;
  type: CallType;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallModal({
  open,
  callerName,
  type,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  if (!open) return null;

  return (
    <div className="safe-inset fixed inset-0 z-[90] flex items-start justify-center bg-black/62 backdrop-blur-sm">
      <div className="premium-panel mt-6 w-full max-w-sm rounded-[26px] px-5 py-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/46">
          Incoming call
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
          {callerName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {type === "video" ? "Video call" : "Voice call"}
        </p>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onDecline}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-red-300/25 bg-red-500/20 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/28"
          >
            <PhoneOff className="h-4 w-4" />
            Decline
          </button>

          <button
            onClick={onAccept}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-200/18 bg-emerald-500/24 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/32"
          >
            {type === "video" ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
