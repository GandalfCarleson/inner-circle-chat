import { useMemo } from "react";
import { getNativePlatform, isNativeApp } from "@/lib/native";

export function useCapacitor() {
  return useMemo(
    () => ({
      isNative: isNativeApp(),
      platform: getNativePlatform(),
    }),
    [],
  );
}
