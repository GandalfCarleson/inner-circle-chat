import { ConstellationLayer, type ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { cn } from "@/lib/utils";

interface Props {
  signal: ConstellationSignal;
  highlightNodeIds: string[];
  className?: string;
}

export function ChatConstellationLayer({ signal, highlightNodeIds, className }: Props) {
  return (
    <div className={cn("chat-constellation-shell", className)} data-signal={signal.kind}>
      <ConstellationLayer
        mode="chat"
        signal={signal}
        highlightNodeIds={highlightNodeIds}
        className="chat-constellation-layer"
      />
      <div key={`beam-${signal.kind}-${signal.key}`} className={cn("chat-constellation-beam", `beam-${signal.kind}`)} />
      <div className="chat-constellation-fog" />
    </div>
  );
}

