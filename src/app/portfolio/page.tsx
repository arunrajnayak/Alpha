'use client';

import { usePortfolioHoldings, useHistoricalHoldings } from '@/hooks/useQueries';
import { useHasMounted } from '@/hooks/useHasMounted';
import PortfolioClient from '@/components/portfolio/PortfolioClient';

// Loading skeleton
function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-10 w-64 bg-slate-800/50 rounded-xl mb-4"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-24 bg-slate-800/50 rounded-2xl border border-white/5"></div>
        ))}
      </div>
      <div className="h-[500px] bg-slate-800/50 rounded-2xl border border-white/5 mt-4"></div>
    </div>
  );
}

export default function PortfolioPage() {
  const { data: currentHoldings, isLoading: holdingsLoading } = usePortfolioHoldings();
  const { data: historicalHoldings, isLoading: historyLoading, isFetching } = useHistoricalHoldings();
  const hasMounted = useHasMounted();

  const isLoading = holdingsLoading || historyLoading;

  // Show skeleton on server render AND initial client load
  if (!hasMounted || (isLoading && (!currentHoldings || !historicalHoldings))) {
    return <PortfolioSkeleton />;
  }

  if (!currentHoldings || !historicalHoldings) {
    return <div className="text-center py-8 text-gray-400">Failed to load portfolio data</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Background refresh indicator */}
      {isFetching && !isLoading && (
        <div className="fixed top-4 right-4 z-50 bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          Refreshing...
        </div>
      )}
      <PortfolioClient 
        currentHoldings={currentHoldings} 
        historicalHoldings={historicalHoldings}
      />
    </div>
  );
}
