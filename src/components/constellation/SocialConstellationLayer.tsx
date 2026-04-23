import type { CSSProperties } from "react";
import type { ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import { useSocialGraph, type SocialGraphConnection } from "@/hooks/useSocialGraph";
import { cn } from "@/lib/utils";

type Mode = "inbox" | "chat";

interface Props {
  mode: Mode;
  signal: ConstellationSignal;
  connections: SocialGraphConnection[];
  className?: string;
}

function settingsForMode(mode: Mode) {
  if (mode === "chat") {
    return { centerX: 50, centerY: 50, maxVisibleNodes: 7 };
  }
  return { centerX: 50, centerY: 40, maxVisibleNodes: 10 };
}

export function SocialConstellationLayer({ mode, signal, connections, className }: Props) {
  const settings = settingsForMode(mode);
  const { nodes } = useSocialGraph({
    connections,
    maxVisibleNodes: settings.maxVisibleNodes,
    centerX: settings.centerX,
    centerY: settings.centerY,
  });

  return (
    <div
      className={cn("social-constellation-layer", `social-constellation-${mode}`, className)}
      data-signal={signal.kind}
    >
      <svg viewBox="0 0 100 100" className="social-constellation-edges" aria-hidden="true">
        {nodes
          .filter((node) => node.kind === "friend")
          .map((node) => (
            <line
              key={`edge:${node.key}`}
              x1={settings.centerX}
              y1={settings.centerY}
              x2={node.x}
              y2={node.y}
              className={cn("social-constellation-edge", `tone-${node.tone}`)}
              strokeWidth={Math.max(0.35, node.lineWidth * (mode === "chat" ? 0.72 : 0.58))}
              strokeOpacity={Math.max(0.08, node.lineOpacity * (mode === "chat" ? 0.62 : 0.5))}
              strokeLinecap="round"
            />
          ))}
      </svg>

      <div className="social-constellation-node-layer">
        {nodes.map((node) => {
          const size =
            node.kind === "friend"
              ? 3.2 + node.strength * (mode === "chat" ? 3.4 : 2.9)
              : node.kind === "cluster"
                ? 4.4
                : 2.6;
          const style = {
            left: `${node.x}%`,
            top: `${node.y}%`,
            width: `${size}px`,
            height: `${size}px`,
            ["--social-node-brightness" as string]: `${node.nodeBrightness}`,
            ["--social-node-motion" as string]: `${node.motionIntensity}`,
            ["--social-node-drift-duration" as string]: `${Math.max(
              4.2,
              8.8 - node.motionIntensity * 4.1,
            ).toFixed(2)}s`,
            ["--social-node-drift-distance" as string]: `${(0.5 + node.motionIntensity * 1.5).toFixed(
              2,
            )}px`,
          } as CSSProperties;

          return (
            <div
              key={node.key}
              className={cn(
                "social-constellation-node",
                `tone-${node.tone}`,
                `kind-${node.kind}`,
                node.online && "is-online",
              )}
              style={style}
            />
          );
        })}
      </div>

      <div key={`signal-${signal.kind}-${signal.key}`} className={cn("social-constellation-wave", `wave-${signal.kind}`)} />
      <div className="social-constellation-vignette" />
    </div>
  );
}
