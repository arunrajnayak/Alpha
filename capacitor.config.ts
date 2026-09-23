import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arunrajnayak.alpha',
  appName: 'Alpha Portfolio',
  webDir: 'out',

  android: {
    allowMixedContent: false,
    backgroundColor: '#0a0f1a', // Dark theme primary background
    // Resize webview when keyboard opens (prevents content being hidden behind keyboard)
    webContentsDebuggingEnabled: false,
  },

  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://alpha-velocity.vercel.app',
    cleartext: (process.env.CAPACITOR_SERVER_URL || '').startsWith('http://'),
    androidScheme: 'https',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchFadeOutDuration: 500,
      backgroundColor: '#0a0f1a',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      // Keep splash on top until app is ready
      launchAutoHide: true,
    },
    Keyboard: {
      // Resize body so content stays visible above keyboard on Android
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      // Match the dark nav background
      backgroundColor: '#0a0f1a',
      style: 'dark',
      overlaysWebView: false,
    },
    // Native HTTP for Capacitor (bypasses CORS issues in WebView)
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
