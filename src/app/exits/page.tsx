'use client';

import React from 'react';
import { usePortfolioExits } from '@/hooks/useQueries';
import { useHasMounted } from '@/hooks/useHasMounted';
import ExitsTable from '@/components/exits/ExitsTable';

// Loading skeleton
function ExitsSkeleton() {
  return (
    <main className="container mx-auto px-2 md:px-4 animate-fade-in max-w-7xl animate-pulse">
      <div className="h-12 w-48 bg-slate-800/50 rounded-xl mb-4"></div>
      <div className="h-[600px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
    </main>
  );
}

export default function ExitsPage() {
  const { data: exits, isLoading, isFetching } = usePortfolioExits();
  const hasMounted = useHasMounted();

  // Show skeleton on server render AND initial client load
  if (!hasMounted || (isLoading && !exits)) {
    return <ExitsSkeleton />;
  }

  if (!exits) {
    return <div className="text-center py-8 text-gray-400">Failed to load exits data</div>;
  }

  return (
    <main className="container mx-auto px-2 md:px-4 animate-fade-in max-w-7xl">
      {/* Background refresh indicator */}
      {isFetching && !isLoading && (
        <div className="fixed top-4 right-4 z-50 bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          Refreshing...
        </div>
      )}
      <ExitsTable exits={exits} />
    </main>
  );
}
