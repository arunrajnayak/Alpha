import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = () => Capacitor.isNativePlatform();
export const isAndroid = () => Capacitor.getPlatform() === 'android';

/**
 * Initialize native app features (status bar, back button handling)
 * Call this in your root layout useEffect
 */
export async function initializeNativeApp() {
  if (!isNative()) return;
  
  // Configure status bar for dark theme
  if (isAndroid()) {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#121212' });
    } catch (e) {
      console.warn('StatusBar configuration failed:', e);
    }
  }
  
  // Handle Android back button
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
}

/**
 * Check if app is running in native container
 */
export function getPlatformInfo() {
  return {
    isNative: isNative(),
    isAndroid: isAndroid(),
    platform: Capacitor.getPlatform(),
  };
}
