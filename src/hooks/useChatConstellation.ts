import { useCallback, useEffect, useRef, useState } from "react";
import type { ConstellationSignal } from "@/components/constellation/ConstellationLayer";

const OUTGOING_PATH = ["c6", "c5", "c4", "c3"];
const INCOMING_PATH = ["c1", "c8", "c9", "c3"];
const TYPING_PATH = ["c4", "c10", "c5"];
const FOCUS_PATH = ["c3", "c6", "c1", "c4"];

interface Params {
  conversationId: string;
  typingPeerActive: boolean;
}

interface Result {
  signal: ConstellationSignal;
  highlightNodeIds: string[];
  emitOutgoingPulse: () => void;
  emitIncomingPulse: () => void;
  emitFocusPulse: () => void;
  emitTypingPulse: () => void;
}

export function useChatConstellation({ conversationId, typingPeerActive }: Params): Result {
  const [signal, setSignal] = useState<ConstellationSignal>({ kind: "focus", key: 0 });
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>(FOCUS_PATH);
  const clearTimerRef = useRef<number | null>(null);

  const emitSignal = useCallback((kind: ConstellationSignal["kind"], nodes: string[] = []) => {
    setSignal((current) => ({ kind, key: current.key + 1 }));
    setHighlightNodeIds(nodes);

    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (nodes.length > 0) {
      clearTimerRef.current = window.setTimeout(() => {
        setHighlightNodeIds([]);
        clearTimerRef.current = null;
      }, 1100);
    }
  }, []);

  useEffect(() => {
    emitSignal("focus", FOCUS_PATH);
  }, [conversationId, emitSignal]);

  useEffect(() => {
    if (!typingPeerActive) return;
    emitSignal("typing", TYPING_PATH);
  }, [emitSignal, typingPeerActive]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const emitOutgoingPulse = useCallback(() => emitSignal("outgoing", OUTGOING_PATH), [emitSignal]);
  const emitIncomingPulse = useCallback(() => emitSignal("incoming", INCOMING_PATH), [emitSignal]);
  const emitFocusPulse = useCallback(() => emitSignal("focus", FOCUS_PATH), [emitSignal]);
  const emitTypingPulse = useCallback(() => emitSignal("typing", TYPING_PATH), [emitSignal]);

  return {
    signal,
    highlightNodeIds,
    emitOutgoingPulse,
    emitIncomingPulse,
    emitFocusPulse,
    emitTypingPulse,
  };
}
