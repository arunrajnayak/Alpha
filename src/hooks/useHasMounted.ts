'use client';

import { useSyncExternalStore } from 'react';

/**
 * Hook to detect if component has mounted on client.
 * Uses useSyncExternalStore to avoid the eslint warning about setState in useEffect.
 * This is the recommended pattern for hydration-safe mounting detection.
 */
export function useHasMounted() {
  return useSyncExternalStore(
    // Subscribe function (no-op since mounted state never changes after mount)
    () => () => {},
    // getSnapshot for client
    () => true,
    // getServerSnapshot
    () => false
  );
}
