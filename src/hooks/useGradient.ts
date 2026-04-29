import { useEffect, useMemo, useState, type CSSProperties } from "react";

type ScreenType = "chat" | "profile" | "friends" | "inbox";

interface GradientOptions {
  activity?: number;
}

interface GradientResult {
  background: string;
  primaryAccent: string;
  secondaryAccent: string;
  style: CSSProperties;
}

interface GradientProfile {
  primaryHue: number;
  secondaryHue: number;
  tertiaryHue: number;
  saturation: number;
  baseLightness: number;
}

const DRIFT_TICK_MS = 45_000;

const PROFILES: Record<ScreenType, GradientProfile> = {
  chat: {
    primaryHue: 24,
    secondaryHue: 12,
    tertiaryHue: 34,
    saturation: 74,
    baseLightness: 3.6,
  },
  profile: {
    primaryHue: 26,
    secondaryHue: 14,
    tertiaryHue: 38,
    saturation: 70,
    baseLightness: 4.2,
  },
  friends: {
    primaryHue: 22,
    secondaryHue: 10,
    tertiaryHue: 36,
    saturation: 68,
    baseLightness: 3.8,
  },
  inbox: {
    primaryHue: 20,
    secondaryHue: 8,
    tertiaryHue: 30,
    saturation: 62,
    baseLightness: 3.4,
  },
};

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function hsla(hue: number, saturation: number, lightness: number, alpha: number) {
  return `hsla(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}% / ${alpha.toFixed(3)})`;
}

function buildGradient(screen: ScreenType, nowMs: number, activity: number) {
  const profile = PROFILES[screen];
  const now = new Date(nowMs);
  const hour = now.getHours() + now.getMinutes() / 60;
  const circadian = Math.cos(((hour - 13) / 24) * Math.PI * 2); // 1 midday, -1 midnight
  const dayLift = circadian * 1.4;
  const drift = Math.sin(nowMs / (1000 * 60 * 22)) * 4.2;
  const softDrift = Math.cos(nowMs / (1000 * 60 * 30)) * 2.8;

  const baseDark = Math.max(1.6, profile.baseLightness - 1.8 + dayLift * 0.18);
  const baseMid = Math.max(2.6, profile.baseLightness + 0.6 + dayLift * 0.25);
  const baseTop = Math.max(3.4, profile.baseLightness + 1.3 + dayLift * 0.34);
  const intensity = 0.05 + activity * 0.11;
  const slowTint = 0.032 + activity * 0.055;

  const primaryHue = profile.primaryHue + drift;
  const secondaryHue = profile.secondaryHue + softDrift;
  const tertiaryHue = profile.tertiaryHue + drift * 0.45;

  const primaryAccent = hsla(primaryHue, profile.saturation + 2, 58 + dayLift * 0.2, 0.56);
  const secondaryAccent = hsla(secondaryHue, profile.saturation + 4, 52 + dayLift * 0.2, 0.44);

  const background = [
    `radial-gradient(circle at 84% 10%, ${hsla(tertiaryHue, profile.saturation + 4, 56, intensity * 0.88)}, transparent 24rem)`,
    `radial-gradient(circle at 14% 90%, ${hsla(secondaryHue, profile.saturation + 3, 46, intensity * 0.84)}, transparent 23rem)`,
    `radial-gradient(circle at 50% 20%, ${hsla(primaryHue, 12, 88, slowTint)}, transparent 28rem)`,
    `linear-gradient(180deg, ${hsla(primaryHue - 2, profile.saturation * 0.58, baseTop, 0.99)}, ${hsla(
      secondaryHue - 6,
      profile.saturation * 0.38,
      baseMid,
      0.995,
    )} 48%, ${hsla(secondaryHue - 10, profile.saturation * 0.28, baseDark, 0.998)})`,
  ].join(",");

  return {
    background,
    primaryAccent,
    secondaryAccent,
  };
}

export function useGradient(screen: ScreenType, options: GradientOptions = {}): GradientResult {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activity = clamp01(options.activity ?? 0.2);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, DRIFT_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return useMemo(() => {
    const gradient = buildGradient(screen, nowMs, activity);
    const style = {
      background: gradient.background,
      ["--dynamic-primary-accent" as string]: gradient.primaryAccent,
      ["--dynamic-secondary-accent" as string]: gradient.secondaryAccent,
    } as CSSProperties;

    return {
      background: gradient.background,
      primaryAccent: gradient.primaryAccent,
      secondaryAccent: gradient.secondaryAccent,
      style,
    };
  }, [activity, nowMs, screen]);
}
