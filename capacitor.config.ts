import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.voideger.void",
  appName: "Void",
  webDir: "dist-mobile",
  backgroundColor: "#090c14",
  plugins: {
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#090c14",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      style: "DARK",
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#090c14",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  android: {
    backgroundColor: "#090c14",
  },
  ios: {
    backgroundColor: "#090c14",
  },
};

export default config;
