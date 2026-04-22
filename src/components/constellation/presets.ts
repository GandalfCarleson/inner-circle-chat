export type ConstellationMode = "inbox" | "chat" | "friends" | "profile";
export type ConstellationTone = "violet" | "cyan" | "amber" | "magenta" | "neutral";

export interface ConstellationNodeSpec {
  id: string;
  x: number;
  y: number;
  size: number;
  tone: ConstellationTone;
  driftX: number;
  driftY: number;
  driftDelay: number;
}

export interface ConstellationEdgeSpec {
  from: string;
  to: string;
  strength: "soft" | "mid" | "strong";
}

export interface ConstellationPreset {
  nodes: ConstellationNodeSpec[];
  edges: ConstellationEdgeSpec[];
}

const INBOX_PRESET: ConstellationPreset = {
  nodes: [
    { id: "n1", x: 14, y: 16, size: 7, tone: "violet", driftX: 1.2, driftY: 1.4, driftDelay: 0 },
    { id: "n2", x: 32, y: 24, size: 10, tone: "cyan", driftX: 1.4, driftY: 0.9, driftDelay: 180 },
    { id: "n3", x: 54, y: 14, size: 8, tone: "magenta", driftX: 0.8, driftY: 1.1, driftDelay: 340 },
    { id: "n4", x: 74, y: 26, size: 11, tone: "violet", driftX: 1.5, driftY: 1.2, driftDelay: 260 },
    { id: "n5", x: 84, y: 17, size: 6, tone: "amber", driftX: 0.9, driftY: 1.3, driftDelay: 420 },
    { id: "n6", x: 18, y: 40, size: 8, tone: "cyan", driftX: 1.1, driftY: 1.6, driftDelay: 520 },
    { id: "n7", x: 42, y: 37, size: 6, tone: "neutral", driftX: 1.3, driftY: 0.8, driftDelay: 620 },
    { id: "n8", x: 66, y: 42, size: 7, tone: "amber", driftX: 1, driftY: 1.1, driftDelay: 740 },
  ],
  edges: [
    { from: "n1", to: "n2", strength: "soft" },
    { from: "n2", to: "n3", strength: "mid" },
    { from: "n3", to: "n4", strength: "soft" },
    { from: "n2", to: "n6", strength: "soft" },
    { from: "n2", to: "n7", strength: "mid" },
    { from: "n4", to: "n8", strength: "soft" },
    { from: "n5", to: "n4", strength: "soft" },
  ],
};

const CHAT_PRESET: ConstellationPreset = {
  nodes: [
    { id: "c1", x: 15, y: 20, size: 8, tone: "violet", driftX: 1.2, driftY: 1.1, driftDelay: 0 },
    { id: "c2", x: 34, y: 13, size: 7, tone: "magenta", driftX: 1.4, driftY: 0.9, driftDelay: 210 },
    { id: "c3", x: 54, y: 18, size: 12, tone: "violet", driftX: 1.1, driftY: 1.2, driftDelay: 340 },
    { id: "c4", x: 78, y: 24, size: 8, tone: "amber", driftX: 1.2, driftY: 1.3, driftDelay: 440 },
    { id: "c5", x: 82, y: 52, size: 9, tone: "amber", driftX: 1, driftY: 1.4, driftDelay: 520 },
    { id: "c6", x: 60, y: 73, size: 12, tone: "cyan", driftX: 1.3, driftY: 1.2, driftDelay: 620 },
    { id: "c7", x: 34, y: 78, size: 7, tone: "cyan", driftX: 1.2, driftY: 1.5, driftDelay: 740 },
    { id: "c8", x: 15, y: 62, size: 10, tone: "violet", driftX: 1, driftY: 1.1, driftDelay: 840 },
    { id: "c9", x: 24, y: 44, size: 6, tone: "neutral", driftX: 0.9, driftY: 0.9, driftDelay: 920 },
    { id: "c10", x: 71, y: 42, size: 6, tone: "neutral", driftX: 1.1, driftY: 1.3, driftDelay: 1020 },
  ],
  edges: [
    { from: "c1", to: "c2", strength: "soft" },
    { from: "c2", to: "c3", strength: "mid" },
    { from: "c3", to: "c4", strength: "strong" },
    { from: "c4", to: "c5", strength: "mid" },
    { from: "c5", to: "c6", strength: "strong" },
    { from: "c6", to: "c7", strength: "mid" },
    { from: "c7", to: "c8", strength: "soft" },
    { from: "c8", to: "c9", strength: "soft" },
    { from: "c9", to: "c3", strength: "mid" },
    { from: "c3", to: "c6", strength: "mid" },
    { from: "c10", to: "c5", strength: "soft" },
  ],
};

const FRIENDS_PRESET: ConstellationPreset = {
  nodes: [
    { id: "center", x: 50, y: 48, size: 12, tone: "violet", driftX: 0.9, driftY: 0.9, driftDelay: 0 },
    { id: "f1", x: 26, y: 24, size: 9, tone: "cyan", driftX: 1.1, driftY: 1.2, driftDelay: 140 },
    { id: "f2", x: 50, y: 18, size: 8, tone: "magenta", driftX: 1.3, driftY: 1, driftDelay: 300 },
    { id: "f3", x: 74, y: 24, size: 9, tone: "amber", driftX: 1.2, driftY: 1.4, driftDelay: 420 },
    { id: "f4", x: 18, y: 52, size: 8, tone: "violet", driftX: 1, driftY: 1.1, driftDelay: 540 },
    { id: "f5", x: 82, y: 52, size: 8, tone: "amber", driftX: 1.1, driftY: 1.3, driftDelay: 640 },
    { id: "f6", x: 26, y: 78, size: 9, tone: "cyan", driftX: 1.2, driftY: 1.2, driftDelay: 760 },
    { id: "f7", x: 50, y: 84, size: 10, tone: "magenta", driftX: 1.2, driftY: 1.5, driftDelay: 860 },
    { id: "f8", x: 74, y: 78, size: 9, tone: "cyan", driftX: 1.1, driftY: 1.2, driftDelay: 960 },
  ],
  edges: [
    { from: "center", to: "f1", strength: "mid" },
    { from: "center", to: "f2", strength: "strong" },
    { from: "center", to: "f3", strength: "mid" },
    { from: "center", to: "f4", strength: "soft" },
    { from: "center", to: "f5", strength: "soft" },
    { from: "center", to: "f6", strength: "mid" },
    { from: "center", to: "f7", strength: "strong" },
    { from: "center", to: "f8", strength: "mid" },
    { from: "f1", to: "f2", strength: "soft" },
    { from: "f2", to: "f3", strength: "soft" },
    { from: "f6", to: "f7", strength: "soft" },
    { from: "f7", to: "f8", strength: "soft" },
  ],
};

const PROFILE_PRESET: ConstellationPreset = {
  nodes: [
    { id: "p1", x: 19, y: 22, size: 7, tone: "amber", driftX: 1, driftY: 1.2, driftDelay: 0 },
    { id: "p2", x: 34, y: 14, size: 8, tone: "magenta", driftX: 1.3, driftY: 0.9, driftDelay: 180 },
    { id: "p3", x: 50, y: 20, size: 13, tone: "violet", driftX: 1, driftY: 1.1, driftDelay: 260 },
    { id: "p4", x: 66, y: 14, size: 8, tone: "amber", driftX: 1.2, driftY: 1.2, driftDelay: 360 },
    { id: "p5", x: 81, y: 24, size: 7, tone: "cyan", driftX: 1.1, driftY: 1.2, driftDelay: 460 },
    { id: "p6", x: 26, y: 40, size: 8, tone: "cyan", driftX: 1.2, driftY: 1.3, driftDelay: 560 },
    { id: "p7", x: 50, y: 48, size: 10, tone: "violet", driftX: 1, driftY: 1.2, driftDelay: 640 },
    { id: "p8", x: 74, y: 40, size: 8, tone: "amber", driftX: 1.3, driftY: 1.1, driftDelay: 760 },
  ],
  edges: [
    { from: "p1", to: "p2", strength: "soft" },
    { from: "p2", to: "p3", strength: "mid" },
    { from: "p3", to: "p4", strength: "mid" },
    { from: "p4", to: "p5", strength: "soft" },
    { from: "p3", to: "p7", strength: "strong" },
    { from: "p6", to: "p7", strength: "mid" },
    { from: "p7", to: "p8", strength: "mid" },
    { from: "p2", to: "p6", strength: "soft" },
    { from: "p4", to: "p8", strength: "soft" },
  ],
};

const PRESETS: Record<ConstellationMode, ConstellationPreset> = {
  inbox: INBOX_PRESET,
  chat: CHAT_PRESET,
  friends: FRIENDS_PRESET,
  profile: PROFILE_PRESET,
};

export function getConstellationPreset(mode: ConstellationMode) {
  return PRESETS[mode];
}
