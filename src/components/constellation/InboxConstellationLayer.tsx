import type { ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { SocialConstellationLayer } from "@/components/constellation/SocialConstellationLayer";
import type { SocialGraphConnection } from "@/hooks/useSocialGraph";
import { cn } from "@/lib/utils";

interface Props {
  signal: ConstellationSignal;
  connections: SocialGraphConnection[];
  className?: string;
}

export function InboxConstellationLayer({ signal, connections, className }: Props) {
  return (
    <SocialConstellationLayer
      mode="inbox"
      signal={signal}
      connections={connections}
      className={cn("inbox-social-constellation", className)}
    />
  );
}
