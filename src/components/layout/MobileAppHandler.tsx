'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setupBackButton, onAppResume } from '@/lib/mobile';

/**
 * MobileAppHandler
 *
 * Client-only component mounted once in RootLayout.
 * Handles Android hardware back button events and app resume events
 * when running inside Capacitor.
 */
export default function MobileAppHandler() {
  const router = useRouter();

  useEffect(() => {
    let cleanupBack: (() => void) | undefined;
    let cleanupResume: (() => void) | undefined;

    setupBackButton().then((cleanup) => {
      cleanupBack = cleanup;
    });

    onAppResume(() => {
      // Re-synchronize route state when app comes to foreground
      router.refresh();
    }).then((cleanup) => {
      cleanupResume = cleanup;
    });

    return () => {
      cleanupBack?.();
      cleanupResume?.();
    };
  }, [router]);

  return null;
}
