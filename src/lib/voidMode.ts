export const VOID_MODE_DURATIONS = [30, 60, 300] as const;

export type VoidModeDurationSeconds = (typeof VOID_MODE_DURATIONS)[number];

export function formatVoidModeDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function computeExpiryIso(durationSeconds: number, nowMs = Date.now()) {
  return new Date(nowMs + durationSeconds * 1000).toISOString();
}

export function isExpired(expiresAt: string | null, nowMs = Date.now()) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= nowMs;
}
