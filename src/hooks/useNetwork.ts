'use client';

import { useEffect, useState } from 'react';
import { onNetworkChange, getNetworkStatus } from '@/lib/mobile';

interface NetworkState {
  connected: boolean;
  connectionType: string;
}

/**
 * Tracks network connectivity using Capacitor Network plugin on Android,
 * or the browser's online/offline events on web.
 *
 * @returns { connected, connectionType }
 */
export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>({
    connected: true,
    connectionType: 'unknown',
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    // Get initial status
    getNetworkStatus().then(setState);

    // Subscribe to changes
    onNetworkChange(setState).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  return state;
}
