'use client';

import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ReactNode, useState } from 'react';

// Create persister for localStorage
const createPersister = () => {
  if (typeof window === 'undefined') return undefined;
  
  return createSyncStoragePersister({
    storage: window.localStorage,
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
        // Refetch on window focus (good for when user returns to app)
        refetchOnWindowFocus: true,
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
  const [persister] = useState(() => createPersister());

  // If we have a persister (client-side), use persistent provider
  if (persister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ 
          persister,
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          buster: 'v1', // Change this to invalidate all cached data
        }}
        onSuccess={() => {
          // Resume any paused mutations and revalidate active queries on restore
          void queryClient.resumePausedMutations();
          void queryClient.invalidateQueries({ refetchType: 'active' });
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  // Server-side fallback
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
