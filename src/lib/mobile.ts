/**
 * Mobile / Capacitor utilities
 *
 * Provides runtime detection of the Android Capacitor shell and helpers for
 * native plugins (haptics, network). Always safe to import in any component —
 * all Capacitor calls are guarded so they are no-ops in the browser.
 */

// ─── Platform detection ────────────────────────────────────────────────────

/** True when the app is running inside the Capacitor Android shell. */
export function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

/** True when running on an Android device inside Capacitor. */
export function isAndroid(): boolean {
  return (
    isCapacitor() &&
    typeof window !== 'undefined' &&
    (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
  );
}

// ─── Haptics ───────────────────────────────────────────────────────────────

type HapticStyle = 'light' | 'medium' | 'heavy';

/**
 * Trigger a haptic impact. Safe to call in the browser — silently no-ops.
 * Uses `@capacitor/haptics` when running in the Android shell.
 */
export async function haptic(style: HapticStyle = 'medium'): Promise<void> {
  if (!isCapacitor()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const styleMap: Record<HapticStyle, (typeof ImpactStyle)[keyof typeof ImpactStyle]> = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    };
    await Haptics.impact({ style: styleMap[style] });
  } catch {
    // Plugin not available — silently ignore
  }
}

/**
 * Trigger a haptic notification (success / warning / error).
 * Uses `@capacitor/haptics` when running in the Android shell.
 */
export async function hapticNotification(type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {
  if (!isCapacitor()) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    const typeMap = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: typeMap[type] });
  } catch {
    // Plugin not available — silently ignore
  }
}

// ─── Network ───────────────────────────────────────────────────────────────

export interface NetworkStatus {
  connected: boolean;
  connectionType: string;
}

/**
 * Get the current network status. Falls back to navigator.onLine in the browser.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (!isCapacitor()) {
    return {
      connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
      connectionType: 'unknown',
    };
  }
  try {
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    return {
      connected: status.connected,
      connectionType: status.connectionType,
    };
  } catch {
    return { connected: true, connectionType: 'unknown' };
  }
}

/**
 * Subscribe to network status changes. Returns an unsubscribe function.
 * In the browser, attaches window online/offline events instead.
 */
export async function onNetworkChange(
  callback: (status: NetworkStatus) => void
): Promise<() => void> {
  if (!isCapacitor()) {
    const onOnline = () => callback({ connected: true, connectionType: 'wifi' });
    const onOffline = () => callback({ connected: false, connectionType: 'none' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }

  try {
    const { Network } = await import('@capacitor/network');
    const handle = await Network.addListener('networkStatusChange', (status) => {
      callback({ connected: status.connected, connectionType: status.connectionType });
    });
    return () => { handle.remove(); };
  } catch {
    return () => {};
  }
}

// ─── App Lifecycle & Hardware Back Button ─────────────────────────────────

/**
 * Configure hardware back button behavior on Android.
 * If the user can go back in web history, navigates back.
 * If at root history, calls onExit or exits the app.
 */
export async function setupBackButton(onExit?: () => void): Promise<() => void> {
  if (!isCapacitor()) return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('backButton', ({ canGoBack }) => {
      haptic('light');
      if (canGoBack && typeof window !== 'undefined' && window.history.length > 1) {
        window.history.back();
      } else if (onExit) {
        onExit();
      } else {
        App.exitApp();
      }
    });
    return () => { handle.remove(); };
  } catch {
    return () => {};
  }
}

/**
 * Subscribe to app state changes (e.g. resuming from background).
 */
export async function onAppResume(callback: () => void): Promise<() => void> {
  if (!isCapacitor()) return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        callback();
      }
    });
    return () => { handle.remove(); };
  } catch {
    return () => {};
  }
}

/**
 * Exit the Capacitor application.
 */
export async function exitApp(): Promise<void> {
  if (!isCapacitor()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch {
    // ignore
  }
}
