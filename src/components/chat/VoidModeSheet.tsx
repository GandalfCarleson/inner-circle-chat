import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VOID_MODE_DURATIONS, formatVoidModeDuration } from "@/lib/voidMode";

interface VoidModeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isActive: boolean;
  currentDurationSeconds: number | null;
  selectedDurationSeconds: number;
  onSelectedDurationChange: (seconds: number) => void;
  onActivate: () => void;
  onDeactivate: () => void;
}

export function VoidModeSheet({
  open,
  onOpenChange,
  isActive,
  currentDurationSeconds,
  selectedDurationSeconds,
  onSelectedDurationChange,
  onActivate,
  onDeactivate,
}: VoidModeSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="premium-panel shell-noise max-w-md border-white/14 bg-[rgba(7,11,19,0.97)] p-0 text-foreground shadow-[0_34px_88px_rgba(0,0,0,0.54)]">
        <DialogHeader className="border-b subtle-divider px-6 pb-5 pt-6 text-left">
          <p className="lux-kicker">Void mode</p>
          <DialogTitle className="mt-2 text-[1.4rem] font-medium tracking-[-0.03em] text-foreground">
            Temporary, focused chat
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
            Messages sent while active are temporary and fade from the thread after the selected
            duration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 pb-6 pt-5">
          <div className="grid grid-cols-3 gap-2">
            {VOID_MODE_DURATIONS.map((seconds) => {
              const active = selectedDurationSeconds === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onSelectedDurationChange(seconds)}
                  className={`rounded-2xl border px-3 py-2.5 text-sm transition ${
                    active
                      ? "border-white/22 bg-white/[0.09] text-foreground"
                      : "border-white/10 bg-white/[0.03] text-white/74 hover:border-white/18 hover:text-foreground"
                  }`}
                >
                  {formatVoidModeDuration(seconds)}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs tracking-[0.01em] text-white/64">
            {isActive && currentDurationSeconds
              ? `Void Mode is active (${formatVoidModeDuration(currentDurationSeconds)}).`
              : "Void Mode is currently off."}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onActivate}
              className="chat-send-button inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl px-4 text-sm font-medium text-primary-foreground"
            >
              {isActive ? "Update Void Mode" : "Activate Void Mode"}
            </button>
            {isActive && (
              <button
                type="button"
                onClick={onDeactivate}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] px-4 text-sm text-white/76 transition hover:border-white/20 hover:text-foreground"
              >
                Turn off
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
