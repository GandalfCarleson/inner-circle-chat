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
    primaryHue: 232,
    secondaryHue: 266,
    tertiaryHue: 284,
    saturation: 42,
    baseLightness: 8,
  },
  profile: {
    primaryHue: 258,
    secondaryHue: 286,
    tertiaryHue: 33,
    saturation: 48,
    baseLightness: 10,
  },
  friends: {
    primaryHue: 226,
    secondaryHue: 274,
    tertiaryHue: 196,
    saturation: 54,
    baseLightness: 8,
  },
  inbox: {
    primaryHue: 224,
    secondaryHue: 244,
    tertiaryHue: 258,
    saturation: 34,
    baseLightness: 7,
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

  const baseDark = Math.max(2.5, profile.baseLightness - 3.6 + dayLift * 0.5);
  const baseMid = Math.max(3.4, profile.baseLightness + 1.2 + dayLift * 0.7);
  const baseTop = Math.max(4.2, profile.baseLightness + 3.8 + dayLift);
  const intensity = 0.08 + activity * 0.16;
  const slowTint = 0.06 + activity * 0.08;

  const primaryHue = profile.primaryHue + drift;
  const secondaryHue = profile.secondaryHue + softDrift;
  const tertiaryHue = profile.tertiaryHue + drift * 0.45;

  const primaryAccent = hsla(primaryHue, profile.saturation + 8, 62 + dayLift * 0.2, 0.66);
  const secondaryAccent = hsla(secondaryHue, profile.saturation + 12, 60 + dayLift * 0.2, 0.56);

  const background = [
    `radial-gradient(circle at 86% 8%, ${hsla(tertiaryHue, profile.saturation + 12, 58, intensity * 0.92)}, transparent 24rem)`,
    `radial-gradient(circle at 12% 92%, ${hsla(secondaryHue, profile.saturation + 10, 54, intensity)}, transparent 22rem)`,
    `radial-gradient(circle at 50% 22%, ${hsla(primaryHue, profile.saturation + 8, 60, slowTint)}, transparent 26rem)`,
    `linear-gradient(180deg, ${hsla(primaryHue - 2, profile.saturation * 0.58, baseTop, 0.99)}, ${hsla(
      secondaryHue - 6,
      profile.saturation * 0.52,
      baseMid,
      0.995,
    )} 48%, ${hsla(secondaryHue - 10, profile.saturation * 0.44, baseDark, 0.998)})`,
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
