'use client';

import React from 'react';
import { usePortfolioExits } from '@/hooks/useQueries';
import ExitsTable from '@/components/exits/ExitsTable';
import { useLiveData } from '@/context/LiveDataContext';

export default function ExitsPage() {
  const { privacyMode } = useLiveData();
  const { data: exits, isLoading, isFetching } = usePortfolioExits();

  if (isLoading && !exits) {
    return (
      <main className="container mx-auto px-2 md:px-4 max-w-7xl animate-pulse">
        <div className="flex flex-col xl:flex-row justify-between items-end mb-6 gap-6">
          <div className="flex flex-col gap-4 w-full xl:w-auto">
            <div className="w-32 md:w-48 h-8 md:h-10 bg-gray-800/50 rounded" />
            <div className="flex flex-wrap gap-2">
              {[...Array(5)].map((_, i) => <div key={i} className="w-14 md:w-16 h-8 bg-gray-800/50 rounded-lg" />)}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full xl:w-auto">
            {[...Array(4)].map((_, i) => <div key={i} className="min-w-[100px] h-[60px] bg-gray-800/50 rounded-lg border border-white/5" />)}
          </div>
        </div>
        <div className="h-[calc(100vh-230px)] bg-gray-800/30 rounded-lg border border-white/5" />
      </main>
    );
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
      <ExitsTable exits={exits} privacyMode={privacyMode} />
    </main>
  );
}
