import type { ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { SocialConstellationLayer } from "@/components/constellation/SocialConstellationLayer";
import type { SocialGraphConnection } from "@/hooks/useSocialGraph";
import { cn } from "@/lib/utils";

interface Props {
  signal: ConstellationSignal;
  connections: SocialGraphConnection[];
  className?: string;
}

export function ChatConstellationLayer({ signal, connections, className }: Props) {
  return (
    <div className={cn("chat-constellation-shell", className)} data-signal={signal.kind}>
      <SocialConstellationLayer
        mode="chat"
        signal={signal}
        connections={connections}
        className="chat-constellation-layer"
      />
      <div key={`beam-${signal.kind}-${signal.key}`} className={cn("chat-constellation-beam", `beam-${signal.kind}`)} />
      <div className="chat-constellation-fog" />
    </div>
  );
}
