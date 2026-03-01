import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arunrajnayak.alpha',
  appName: 'Alpha Portfolio',
  webDir: 'out',
  
  // Hybrid approach - point to Vercel deployment
  server: {
    url: 'https://alpha-velocity.vercel.app',
    cleartext: false
  },
  
  android: {
    allowMixedContent: false,
    backgroundColor: '#121212', // Dark theme background
  },
  
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#121212',
      showSpinner: false,
    },
  },
};

export default config;
