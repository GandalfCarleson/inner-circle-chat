export interface ConnectionStrengthInput {
  totalMessages: number;
  lastMessageAt: string | null;
  isOnline: boolean;
  isTyping?: boolean;
}

export interface ConnectionStrengthScore {
  score: number;
  messageScore: number;
  recencyScore: number;
  activityScore: number;
}

export interface ConnectionVisualProps {
  radius: number;
  nodeBrightness: number;
  lineOpacity: number;
  lineWidth: number;
  motionIntensity: number;
  tone: "violet" | "cyan" | "amber";
}

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeMessageVolume(totalMessages: number) {
  const safeCount = Math.max(0, totalMessages);
  return clamp01(Math.log1p(safeCount) / Math.log1p(220));
}

function normalizeRecency(lastMessageAt: string | null, nowMs: number) {
  if (!lastMessageAt) return 0;
  const timestamp = new Date(lastMessageAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;

  const elapsedHours = Math.max(0, (nowMs - timestamp) / (1000 * 60 * 60));
  // Weekly decay curve keeps visible drift gradual while still rewarding fresh interactions.
  return clamp01(Math.exp(-elapsedHours / 168));
}

export function computeConnectionStrength(
  input: ConnectionStrengthInput,
  nowMs: number,
): ConnectionStrengthScore {
  const messageScore = normalizeMessageVolume(input.totalMessages);
  const recencyScore = normalizeRecency(input.lastMessageAt, nowMs);
  const activityScore = clamp01((input.isOnline ? 0.12 : 0) + (input.isTyping ? 0.2 : 0));

  const score = clamp01(messageScore * 0.56 + recencyScore * 0.34 + activityScore);
  return {
    score,
    messageScore,
    recencyScore,
    activityScore,
  };
}

export function mapToVisualProperties(
  strength: ConnectionStrengthScore,
  input: Pick<ConnectionStrengthInput, "isOnline" | "isTyping">,
): ConnectionVisualProps {
  const radius = 17 + (1 - strength.score) * 26;
  const nodeBrightness = clamp01(
    0.44 + strength.score * 0.42 + (input.isOnline ? 0.08 : 0) + (input.isTyping ? 0.08 : 0),
  );
  const lineOpacity = clamp01(
    0.12 + strength.score * 0.46 + (input.isOnline ? 0.06 : 0) + (input.isTyping ? 0.08 : 0),
  );
  const lineWidth = 0.5 + strength.score * 0.9 + (input.isTyping ? 0.2 : 0);
  const motionIntensity = clamp01(0.18 + strength.score * 0.52 + (input.isOnline ? 0.1 : 0));

  let tone: ConnectionVisualProps["tone"] = "violet";
  if (strength.score > 0.85 && strength.messageScore > 0.66 && strength.recencyScore > 0.48) {
    tone = "amber";
  } else if (input.isOnline || strength.recencyScore > 0.6) {
    tone = "cyan";
  }

  return {
    radius,
    nodeBrightness,
    lineOpacity,
    lineWidth,
    motionIntensity,
    tone,
  };
}

export function hashToUnit(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash % 1000) / 1000;
}
