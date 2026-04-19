import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.voideger.void',
  appName: 'Void',
  webDir: 'dist-mobile',
  backgroundColor: '#1F313B',
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1F313B',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1F313B',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    backgroundColor: '#1F313B',
  },
  ios: {
    backgroundColor: '#1F313B',
  },
};

export default config;
