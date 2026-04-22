import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeConnectionStrength,
  hashToUnit,
  mapToVisualProperties,
  type ConnectionVisualProps,
} from "@/lib/socialGraph";

export interface SocialGraphConnection {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  totalMessages: number;
  lastMessageAt: string | null;
  isOnline: boolean;
  isTyping?: boolean;
}

export interface SocialGraphNode extends ConnectionVisualProps {
  key: string;
  kind: "friend" | "cluster" | "ghost";
  id?: string;
  name: string;
  username?: string;
  avatarUrl?: string | null;
  x: number;
  y: number;
  online: boolean;
  totalMessages: number;
  lastMessageAt: string | null;
  overflowCount?: number;
  strength: number;
}

interface Params {
  connections: SocialGraphConnection[];
  maxVisibleNodes?: number;
  centerX?: number;
  centerY?: number;
}

const GHOST_LABELS = ["Invite", "Network"];

interface NodeTarget {
  key: string;
  x: number;
  y: number;
  payload: Omit<SocialGraphNode, "x" | "y">;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easingOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

export function useSocialGraph({
  connections,
  maxVisibleNodes = 8,
  centerX = 50,
  centerY = 48,
}: Params) {
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [animatedNodes, setAnimatedNodes] = useState<SocialGraphNode[]>([]);
  const previousByKeyRef = useRef<Map<string, SocialGraphNode>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockMs(Date.now());
    }, 45_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const computedTargets = useMemo(() => {
    const rankedConnections = connections
      .map((connection) => {
        const strength = computeConnectionStrength(
          {
            totalMessages: connection.totalMessages,
            lastMessageAt: connection.lastMessageAt,
            isOnline: connection.isOnline,
            isTyping: connection.isTyping,
          },
          clockMs,
        );
        const visual = mapToVisualProperties(strength, {
          isOnline: connection.isOnline,
          isTyping: connection.isTyping,
        });
        return {
          connection,
          strength,
          visual,
        };
      })
      .sort((left, right) => {
        if (right.strength.score !== left.strength.score) {
          return right.strength.score - left.strength.score;
        }
        return right.connection.totalMessages - left.connection.totalMessages;
      });

    if (rankedConnections.length === 0) {
      const ghostTargets: NodeTarget[] = GHOST_LABELS.map((label, index) => {
        const angle = -Math.PI / 2 + index * Math.PI;
        const radius = 29;
        return {
          key: `ghost:${label}`,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius * 0.86,
          payload: {
            key: `ghost:${label}`,
            kind: "ghost",
            name: label,
            username: undefined,
            avatarUrl: null,
            online: false,
            totalMessages: 0,
            lastMessageAt: null,
            strength: 0,
            ...mapToVisualProperties(
              {
                score: 0,
                messageScore: 0,
                recencyScore: 0,
                activityScore: 0,
              },
              { isOnline: false, isTyping: false },
            ),
          },
        };
      });

      return {
        targets: ghostTargets,
        overflowCount: 0,
        strongestConnectionId: null as string | null,
      };
    }

    const hasOverflow = rankedConnections.length > maxVisibleNodes;
    const friendCount = hasOverflow ? maxVisibleNodes - 1 : maxVisibleNodes;
    const visibleConnections = rankedConnections.slice(0, friendCount);
    const overflowCount = rankedConnections.length - visibleConnections.length;

    const targets: NodeTarget[] = visibleConnections.map((item, index) => {
      const friend = item.connection;
      const normalizedIndex = visibleConnections.length <= 1 ? 0.5 : index / visibleConnections.length;
      const angleOffset = hashToUnit(friend.id) * 0.5 - 0.25;
      const angle =
        -Math.PI / 2 +
        normalizedIndex * Math.PI * 2 +
        angleOffset * (Math.PI / Math.max(3, visibleConnections.length));
      const radius = item.visual.radius;

      return {
        key: `friend:${friend.id}`,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.84,
        payload: {
          key: `friend:${friend.id}`,
          id: friend.id,
          kind: "friend",
          name: friend.name,
          username: friend.username,
          avatarUrl: friend.avatarUrl,
          online: friend.isOnline,
          totalMessages: friend.totalMessages,
          lastMessageAt: friend.lastMessageAt,
          strength: item.strength.score,
          ...item.visual,
        },
      };
    });

    if (hasOverflow) {
      const angle = Math.PI * 0.68;
      const radius = 37;
      targets.push({
        key: "cluster:overflow",
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.84,
        payload: {
          key: "cluster:overflow",
          kind: "cluster",
          name: "More",
          username: undefined,
          avatarUrl: null,
          online: false,
          totalMessages: 0,
          lastMessageAt: null,
          overflowCount,
          strength: 0.25,
          ...mapToVisualProperties(
            {
              score: 0.28,
              messageScore: 0.2,
              recencyScore: 0.2,
              activityScore: 0,
            },
            { isOnline: false, isTyping: false },
          ),
        },
      });
    }

    return {
      targets,
      overflowCount,
      strongestConnectionId: rankedConnections[0]?.connection.id ?? null,
    };
  }, [centerX, centerY, clockMs, connections, maxVisibleNodes]);

  useEffect(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const previousByKey = previousByKeyRef.current;
    const startTime = performance.now();
    const durationMs = 420;
    let mounted = true;

    function step(now: number) {
      if (!mounted) return;
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = easingOutCubic(progress);

      const nextNodes = computedTargets.targets.map((target) => {
        const previous = previousByKey.get(target.key);
        if (!previous) {
          return {
            ...target.payload,
            x: target.x,
            y: target.y,
          };
        }

        return {
          ...target.payload,
          x: lerp(previous.x, target.x, eased),
          y: lerp(previous.y, target.y, eased),
        };
      });

      setAnimatedNodes(nextNodes);

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        const settled = new Map<string, SocialGraphNode>();
        for (const node of nextNodes) {
          settled.set(node.key, node);
        }
        previousByKeyRef.current = settled;
        animationFrameRef.current = null;
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      mounted = false;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [computedTargets]);

  useEffect(() => {
    if (animatedNodes.length > 0) return;
    const seeded = computedTargets.targets.map((target) => ({
      ...target.payload,
      x: target.x,
      y: target.y,
    }));
    setAnimatedNodes(seeded);
  }, [animatedNodes.length, computedTargets.targets]);

  return {
    nodes: animatedNodes,
    overflowCount: computedTargets.overflowCount,
    strongestConnectionId: computedTargets.strongestConnectionId,
  };
}
