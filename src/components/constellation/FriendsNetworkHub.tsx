import type { CSSProperties } from "react";
import { MessageCircle, Sparkles } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { ConstellationSignal } from "@/components/constellation/ConstellationLayer";
import type { SocialGraphNode } from "@/hooks/useSocialGraph";
import { cn } from "@/lib/utils";

const GRAPH_CENTER_X = 50;
const GRAPH_CENTER_Y = 48;

interface Preview {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  online: boolean;
  lastInteraction: string;
}

interface Props {
  totalFriends: number;
  selectedFriendId: string | null;
  strongestFriendId: string | null;
  signal: ConstellationSignal;
  nodes: SocialGraphNode[];
  spawnedFriendIds: Record<string, true>;
  defocused: boolean;
  preview: Preview | null;
  onNodePress: (node: SocialGraphNode) => void;
  onOpenFriend: (friendId: string) => void;
}

export function FriendsNetworkHub({
  totalFriends,
  selectedFriendId,
  strongestFriendId,
  signal,
  nodes,
  spawnedFriendIds,
  defocused,
  preview,
  onNodePress,
  onOpenFriend,
}: Props) {
  return (
    <section className="surface-primary mb-8 rounded-[26px] p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/42">Network Hub</p>
          <p className="mt-1 text-sm text-foreground">Your active connections</p>
        </div>
        <span className="text-xs text-white/36">{totalFriends} linked</span>
      </div>

      <div
        className={`friends-network-hub ${defocused ? "is-defocused" : ""}`}
        data-signal={signal.kind}
      >
        <svg viewBox="0 0 100 100" className="friends-network-edges" aria-hidden="true">
          {nodes
            .filter((node) => node.kind === "friend")
            .map((node) => {
              const selected = node.id === selectedFriendId;
              const strokeOpacity = Math.min(1, node.lineOpacity + (selected ? 0.22 : 0));
              return (
                <line
                  key={`edge:${node.key}`}
                  x1={GRAPH_CENTER_X}
                  y1={GRAPH_CENTER_Y}
                  x2={node.x}
                  y2={node.y}
                  className={cn("friends-network-edge", `tone-${node.tone}`, selected && "is-selected")}
                  strokeWidth={node.lineWidth + (selected ? 0.2 : 0)}
                  strokeOpacity={strokeOpacity}
                  strokeLinecap="round"
                />
              );
            })}
        </svg>

        <div className="friends-network-hub-glow" />
        <div key={`signal-${signal.kind}-${signal.key}`} className={`friends-network-signal signal-${signal.kind}`} />

        <button
          type="button"
          className="friends-network-user-node friends-network-center-node"
          style={{ left: `${GRAPH_CENTER_X}%`, top: `${GRAPH_CENTER_Y}%` }}
          aria-label="You"
        >
          <Avatar name="You" url={null} size="sm" className="h-11 w-11 border border-white/20" />
          <span className="friends-network-node-label">You</span>
        </button>

        {nodes.map((node) => {
          const isSelected = node.kind === "friend" && selectedFriendId === node.id;
          const isSpawned =
            node.kind === "friend" && node.id ? Boolean(spawnedFriendIds[node.id]) : false;
          const nodeStyle = {
            left: `${node.x}%`,
            top: `${node.y}%`,
            ["--node-brightness" as string]: `${node.nodeBrightness}`,
            ["--node-motion" as string]: `${node.motionIntensity}`,
            ["--node-drift-duration" as string]: `${Math.max(
              4.6,
              8.8 - node.motionIntensity * 3.8,
            ).toFixed(2)}s`,
            ["--node-drift-distance" as string]: `${(0.7 + node.motionIntensity * 1.7).toFixed(
              2,
            )}px`,
            opacity: 0.62 + node.nodeBrightness * 0.38,
          } as CSSProperties;

          return (
            <button
              key={node.key}
              type="button"
              onClick={() => onNodePress(node)}
              className={`friends-network-user-node ${isSelected ? "is-selected" : ""} ${
                node.online && node.kind === "friend" ? "is-online" : ""
              } ${node.id && node.id === strongestFriendId ? "is-priority" : ""} ${isSpawned ? "is-spawned" : ""} ${
                node.kind === "ghost" ? "is-ghost" : ""
              } ${node.kind === "cluster" ? "is-cluster" : ""}`}
              style={nodeStyle}
              aria-label={
                node.kind === "cluster"
                  ? `${node.overflowCount ?? 0} more connections`
                  : node.kind === "ghost"
                    ? "Potential connection"
                    : node.name
              }
            >
              {node.kind === "cluster" ? (
                <span className="friends-network-cluster-pill">+{node.overflowCount ?? 0}</span>
              ) : (
                <Avatar
                  name={node.name}
                  url={node.avatarUrl}
                  size="sm"
                  className={`h-9 w-9 border ${node.id === selectedFriendId ? "border-white/28" : "border-white/14"}`}
                />
              )}

              {node.online && node.kind === "friend" && <span className="friends-network-online-dot" />}
              <span className="friends-network-node-label">{node.name}</span>
            </button>
          );
        })}

        {preview ? (
          <div className="friends-network-preview">
            <Avatar name={preview.name} url={preview.avatarUrl} size="sm" className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{preview.name}</p>
              <p className="truncate text-[11px] text-white/52">
                @{preview.username} · {preview.online ? "Online now" : preview.lastInteraction}
              </p>
            </div>
            <button
              onClick={() => onOpenFriend(preview.id)}
              className="friends-network-preview-action"
              aria-label={`Message ${preview.name}`}
            >
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="friends-network-preview is-empty">
            <Sparkles className="h-4 w-4 text-white/56" />
            <p className="text-xs text-white/52">
              {totalFriends === 0
                ? "Add your first connection to light up the network."
                : "Tap a node to preview or message that friend."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
