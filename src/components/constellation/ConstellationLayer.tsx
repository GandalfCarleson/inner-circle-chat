import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  getConstellationPreset,
  type ConstellationMode,
  type ConstellationNodeSpec,
} from "@/components/constellation/presets";

type SignalKind = "idle" | "focus" | "outgoing" | "incoming" | "typing" | "highlight";

export interface ConstellationSignal {
  kind: SignalKind;
  key: number;
}

interface Props {
  mode: ConstellationMode;
  className?: string;
  signal?: ConstellationSignal;
  highlightNodeIds?: string[];
  nodeClassName?: string;
  lineClassName?: string;
}

function cssVarsForNode(node: ConstellationNodeSpec) {
  return {
    left: `${node.x}%`,
    top: `${node.y}%`,
    ["--constellation-node-size" as string]: `${node.size}px`,
    ["--constellation-drift-x" as string]: `${node.driftX}px`,
    ["--constellation-drift-y" as string]: `${node.driftY}px`,
    ["--constellation-drift-delay" as string]: `${node.driftDelay}ms`,
  } as CSSProperties;
}

export function ConstellationLayer({
  mode,
  className,
  signal,
  highlightNodeIds,
  nodeClassName,
  lineClassName,
}: Props) {
  const preset = getConstellationPreset(mode);
  const highlightSet = useMemo(() => new Set(highlightNodeIds ?? []), [highlightNodeIds]);
  const signalKind = signal?.kind ?? "idle";
  const signalKey = signal?.key ?? 0;

  const nodeById = useMemo(() => {
    return new Map(preset.nodes.map((node) => [node.id, node]));
  }, [preset.nodes]);

  return (
    <div
      className={cn("constellation-layer", `constellation-mode-${mode}`, className)}
      data-signal={signalKind}
    >
      <svg viewBox="0 0 100 100" className={cn("constellation-lines", lineClassName)} aria-hidden="true">
        <defs>
          <linearGradient id={`constellation-edge-${mode}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(137,103,226,0.78)" />
            <stop offset="58%" stopColor="rgba(87,194,243,0.62)" />
            <stop offset="100%" stopColor="rgba(242,171,98,0.58)" />
          </linearGradient>
        </defs>
        {preset.edges.map((edge, index) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;

          return (
            <line
              key={`${edge.from}-${edge.to}-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={cn("constellation-edge", `edge-${edge.strength}`)}
              stroke={`url(#constellation-edge-${mode})`}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <div className={cn("constellation-node-layer", nodeClassName)}>
        {preset.nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              "constellation-node",
              `tone-${node.tone}`,
              highlightSet.has(node.id) && "is-highlighted",
            )}
            style={cssVarsForNode(node)}
          />
        ))}
      </div>

      <div key={`${signalKind}-${signalKey}`} className={cn("constellation-wave", `wave-${signalKind}`)} />
      <div className="constellation-vignette" />
    </div>
  );
}
