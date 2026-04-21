import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const KEYBOARD_OPEN_THRESHOLD = 120;

export function useKeyboardVisibility() {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const baselineHeightRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const viewport = window.visualViewport;
    const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

    const readHeight = () => viewport?.height ?? window.innerHeight;

    const handleViewportChange = () => {
      const nextHeight = readHeight();
      baselineHeightRef.current = Math.max(baselineHeightRef.current, nextHeight);
      const keyboardHeight = baselineHeightRef.current - nextHeight;
      setKeyboardVisible(keyboardHeight > KEYBOARD_OPEN_THRESHOLD);
    };

    baselineHeightRef.current = readHeight();
    handleViewportChange();

    if (Capacitor.isNativePlatform()) {
      void Keyboard.addListener("keyboardWillShow", () => {
        setKeyboardVisible(true);
      }).then((handle) => listenerHandles.push(handle));

      void Keyboard.addListener("keyboardDidShow", () => {
        setKeyboardVisible(true);
      }).then((handle) => listenerHandles.push(handle));

      void Keyboard.addListener("keyboardWillHide", () => {
        setKeyboardVisible(false);
      }).then((handle) => listenerHandles.push(handle));

      void Keyboard.addListener("keyboardDidHide", () => {
        setKeyboardVisible(false);
      }).then((handle) => listenerHandles.push(handle));
    }

    const handleOrientationChange = () => {
      // Reset baseline after orientation updates settle.
      window.setTimeout(() => {
        baselineHeightRef.current = readHeight();
        handleViewportChange();
      }, 80);
    };
    window.addEventListener("orientationchange", handleOrientationChange);

    if (viewport) {
      viewport.addEventListener("resize", handleViewportChange);
      viewport.addEventListener("scroll", handleViewportChange);
    } else {
      window.addEventListener("resize", handleViewportChange);
    }

    return () => {
      if (viewport) {
        viewport.removeEventListener("resize", handleViewportChange);
        viewport.removeEventListener("scroll", handleViewportChange);
      } else {
        window.removeEventListener("resize", handleViewportChange);
      }
      window.removeEventListener("orientationchange", handleOrientationChange);
      for (const handle of listenerHandles) {
        void handle.remove();
      }
    };
  }, []);

  return keyboardVisible;
}
