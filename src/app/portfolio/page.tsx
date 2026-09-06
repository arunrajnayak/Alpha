'use client';

import { Suspense, useState, useEffect } from 'react';
import { usePortfolioHoldings, useHistoricalHoldings } from '@/hooks/useQueries';
import PortfolioClient from '@/components/portfolio/PortfolioClient';
import { useLiveData } from '@/context/LiveDataContext';
import PortfolioLoading from './loading';

function PortfolioContent() {
  const [mounted, setMounted] = useState(false);
  const { privacyMode } = useLiveData();
  const { data: currentHoldings, isLoading: holdingsLoading } = usePortfolioHoldings();
  const { data: historicalHoldings, isLoading: historyLoading, isFetching } = useHistoricalHoldings();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isLoading = holdingsLoading || historyLoading;

  if (!mounted || (isLoading && (!currentHoldings || !historicalHoldings))) {
    return <PortfolioLoading />;
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
        privacyMode={privacyMode}
      />
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<PortfolioLoading />}>
      <PortfolioContent />
    </Suspense>
  );
}

