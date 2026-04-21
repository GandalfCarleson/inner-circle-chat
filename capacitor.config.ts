import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.voideger.void",
  appName: "Void",
  webDir: "dist-mobile",
  backgroundColor: "#614385",
  plugins: {
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#614385",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      style: "DARK",
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#614385",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  android: {
    backgroundColor: "#614385",
  },
  ios: {
    backgroundColor: "#614385",
  },
};

export default config;
