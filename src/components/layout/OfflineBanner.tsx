'use client';

import { useNetwork } from '@/hooks/useNetwork';

/**
 * OfflineBanner
 *
 * Displays a dismissible banner at the top of the page when the device
 * loses network connectivity. Uses the Capacitor Network plugin on Android
 * and browser online/offline events on web.
 *
 * Rendered inside the root layout, just below the Header.
 */
export default function OfflineBanner() {
  const { connected } = useNetwork();

  if (connected) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-amber-100 bg-amber-600/90 backdrop-blur-sm border-b border-amber-500/50 z-50"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-200 animate-pulse" />
      No internet connection — data may be stale
    </div>
  );
}
