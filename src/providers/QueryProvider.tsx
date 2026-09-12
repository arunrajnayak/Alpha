'use client';

import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ReactNode, useEffect, useState } from 'react';

// Create async persister for localStorage (non-blocking)
const createPersister = () => {
  if (typeof window === 'undefined') return undefined;

  return createAsyncStoragePersister({
    storage: {
      getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve(); },
      removeItem: (key: string) => { localStorage.removeItem(key); return Promise.resolve(); },
    },
    key: 'alpha-query-cache',
  });
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 30 seconds
        staleTime: 30 * 1000,
        // Cache is kept for 24 hours
        gcTime: 24 * 60 * 60 * 1000,
        // Retry failed requests up to 2 times
        retry: 2,
        // Keep previous data visible while revalidating or changing keys
        placeholderData: keepPreviousData,
        // Don't refetch on window focus - freshness managed by staleTime + manual refresh
        refetchOnWindowFocus: false,
        // Don't refetch when first reconnecting (too aggressive)
        refetchOnReconnect: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: reuse existing query client
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());

  useEffect(() => {
    const persister = createPersister();
    if (!persister) return;

    const [unsubscribe, promise] = persistQueryClient({
      queryClient,
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      buster: process.env.NEXT_PUBLIC_APP_VERSION ?? 'v1',
    });

    void promise.then(() => {
      // Resume any paused mutations and revalidate active queries on restore
      void queryClient.resumePausedMutations();
      void queryClient.invalidateQueries({ refetchType: 'active' });
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
