import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const APP_DARK_BACKGROUND = "#090c14";

async function waitForWebFirstPaint() {
  if (typeof window === "undefined") return;

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function getNativePlatform() {
  return Capacitor.getPlatform();
}

export async function initializeNativeShell() {
  if (!isNativeApp()) return;

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: APP_DARK_BACKGROUND });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (error) {
    console.warn("Failed to configure status bar", error);
  }

  try {
    // Native resize keeps chat layouts stable while the keyboard appears.
    await Keyboard.setResizeMode({ mode: "native" });
  } catch (error) {
    console.warn("Failed to configure keyboard resize mode", error);
  }

  try {
    await waitForWebFirstPaint();
    await SplashScreen.hide();
  } catch (error) {
    console.warn("Failed to hide splash screen", error);
  }

  try {
    await App.addListener("appStateChange", ({ isActive }) => {
      document.documentElement.toggleAttribute("data-app-active", isActive);
    });
  } catch (error) {
    console.warn("Failed to attach app listeners", error);
  }
}

export async function triggerSelectionHaptic() {
  if (!isNativeApp()) return;

  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (error) {
    console.warn("Failed to trigger haptic feedback", error);
  }
}
