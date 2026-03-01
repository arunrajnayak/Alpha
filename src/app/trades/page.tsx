'use client';

import { useTransactions, useSymbolMappings } from '@/hooks/useQueries';
import { useHasMounted } from '@/hooks/useHasMounted';
import ManageTradesClient from './ManageTradesClient';

// Loading skeleton
function TradesSkeleton() {
  return (
    <main className="animate-fade-in flex flex-col h-[calc(100vh-8rem)] animate-pulse">
      <div className="flex-1 min-h-0">
        <div className="h-12 w-48 bg-slate-800/50 rounded-xl mb-4"></div>
        <div className="h-full bg-slate-800/50 rounded-2xl border border-white/5"></div>
      </div>
    </main>
  );
}

export default function TradesPage() {
  const { data: transactions, isLoading: transactionsLoading } = useTransactions();
  const { data: mappings, isLoading: mappingsLoading, isFetching } = useSymbolMappings();
  const hasMounted = useHasMounted();

  const isLoading = transactionsLoading || mappingsLoading;

  // Show skeleton on server render AND initial client load
  if (!hasMounted || (isLoading && (!transactions || !mappings))) {
    return <TradesSkeleton />;
  }

  if (!transactions) {
    return <div className="text-center py-8 text-gray-400">Failed to load transactions</div>;
  }

  return (
    <main className="animate-fade-in flex flex-col h-[calc(100vh-8rem)]">
      {/* Background refresh indicator */}
      {isFetching && !isLoading && (
        <div className="fixed top-4 right-4 z-50 bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          Refreshing...
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ManageTradesClient 
          initialTransactions={transactions} 
          initialMappings={mappings || {}} 
        />
      </div>
    </main>
  );
}
