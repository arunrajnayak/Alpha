'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { fetchMarketOverview, fetchAllIndexSummaries } from '@/app/actions/market-overview';
import type { MarketOverviewData, ConstituentQuote } from '@/app/actions/market-overview';
import { isMarketOpen } from '@/lib/market-status-utils';
import AdvanceDecline from '@/components/market/AdvanceDecline';
import TopMovers from '@/components/market/TopMovers';
import IndexSummaryCards from '@/components/market/IndexSummaryCards';
import { useUpstoxStream, PriceUpdate, StreamStatus } from '@/hooks/useUpstoxStream';

const MarketHeatmap = dynamic(() => import('@/components/market/MarketHeatmap'), {
  loading: () => <div className="h-[500px] bg-slate-800/50 rounded-2xl animate-pulse" />,
  ssr: false,
});

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
};

interface IndexSummary {
  name: string;
  shortName: string;
  category: string;
  value: number;
  change: number;
  changePercent: number;
  instrumentKey: string;
}

const UPDATE_INTERVAL_MS = 1000; // Batch UI updates every 1 second

export default function MarketOverviewPage() {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY 50');
  const [indexSummaries, setIndexSummaries] = useState<IndexSummary[]>([]);
  const [data, setData] = useState<MarketOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  
  const [tokenStatus, setTokenStatus] = useState<{ hasToken: boolean; message?: string } | null>(null);
  
  // Refresh timers
  const dataRefreshRef = useRef<NodeJS.Timeout | null>(null);

  // Streaming buffers
  const pendingUpdatesRef = useRef<Map<string, PriceUpdate>>(new Map());
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBatchAppliedRef = useRef<number>(0);

  // Responsive check
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Set formatted last updated time
  const updateTimestamp = useCallback(() => {
    setLastUpdated(new Date().toLocaleTimeString('en-IN', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }));
  }, []);

  // Fetch index summaries (REST fallback)
  const loadSummaries = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setSummariesLoading(true);
      const res = await fetchAllIndexSummaries();
      if (res.summaries.length > 0) {
        setIndexSummaries(res.summaries);
      }
      if (res.tokenStatus) {
        setTokenStatus(res.tokenStatus);
      }
    } catch (err) {
      console.error('Failed to load index summaries:', err);
    } finally {
      if (showLoading) setSummariesLoading(false);
    }
  }, []);

  // Fetch data for selected index (REST)
  const loadData = useCallback(async (indexName: string) => {
    try {
      setLoading(true);
      const result = await fetchMarketOverview(indexName);
      if (result) {
        setData(result);
        updateTimestamp();
        if (result.tokenStatus) {
          setTokenStatus(result.tokenStatus);
        }
      }
    } catch (err) {
      console.error(`Failed to load market data for ${indexName}:`, err);
    } finally {
      setLoading(false);
    }
  }, [updateTimestamp]);

  // Initial load
  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  // Load data when index changes
  useEffect(() => {
    loadData(selectedIndex);
  }, [selectedIndex, loadData]);

  // Handle batched streaming updates to avoid UI stutter
  const applyBatchedUpdates = useCallback(() => {
    const updates = pendingUpdatesRef.current;
    if (updates.size === 0) return;

    pendingUpdatesRef.current = new Map();
    lastBatchAppliedRef.current = Date.now();

    const updateMap = new Map<string, PriceUpdate>();
    for (const [, update] of updates) {
      updateMap.set(update.symbol, update);
    }

    // 1. Update Index Summaries
    setIndexSummaries(prev => prev.map(idx => {
      const update = updateMap.get(idx.instrumentKey);
      if (!update || !update.ltp || update.ltp <= 0) return idx;

      const prevClose = update.previousClose || idx.value - idx.change;
      const change = update.ltp - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

      return {
        ...idx,
        value: update.ltp,
        change,
        changePercent,
      };
    }));

    // 2. Update Main Data (if available)
    setData(currentData => {
      if (!currentData) return currentData;

      let anyConstituentChanged = false;

      const updatedConstituents = currentData.constituents.map(c => {
        const update = updateMap.get(c.instrumentKey);
        if (!update || !update.ltp || update.ltp <= 0) return c;

        anyConstituentChanged = true;
        const prevClose = update.previousClose || c.prevClose;
        const change = update.ltp - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

        return {
          ...c,
          lastPrice: update.ltp,
          change,
          changePercent,
          prevClose,
        };
      });

      // Update index value if its update is in this batch
      let newIndexValue = currentData.indexValue;
      let newIndexChange = currentData.indexChange;
      let newIndexChangePercent = currentData.indexChangePercent;

      // Find the currently selected index in summaries to check if its value updated
      const selectedIndexSummaryUpdate = Array.from(updateMap.values()).find(
        u => indexSummaries.find(s => s.name === currentData.indexName && s.instrumentKey === u.symbol)
      );

      if (selectedIndexSummaryUpdate && selectedIndexSummaryUpdate.ltp && selectedIndexSummaryUpdate.ltp > 0) {
        const prevClose = selectedIndexSummaryUpdate.previousClose || currentData.indexValue - currentData.indexChange;
        newIndexValue = selectedIndexSummaryUpdate.ltp;
        newIndexChange = newIndexValue - prevClose;
        newIndexChangePercent = prevClose > 0 ? (newIndexChange / prevClose) * 100 : 0;
      }

      if (!anyConstituentChanged && newIndexValue === currentData.indexValue) {
        return currentData; // No updates for this specific view
      }

      // Recalculate advance/decline
      let advancing = 0;
      let declining = 0;
      let unchanged = 0;
      for (const c of updatedConstituents) {
        if (c.changePercent > 0.01) advancing++;
        else if (c.changePercent < -0.01) declining++;
        else unchanged++;
      }

      // Recalculate gainers/losers
      const sorted = [...updatedConstituents].sort((a, b) => b.changePercent - a.changePercent);
      const topGainers = sorted.filter(c => c.changePercent > 0).slice(0, 10);
      const topLosers = sorted.filter(c => c.changePercent < 0).reverse().slice(0, 10);

      return {
        ...currentData,
        indexValue: newIndexValue,
        indexChange: newIndexChange,
        indexChangePercent: newIndexChangePercent,
        constituents: sorted,
        advancing,
        declining,
        unchanged,
        topGainers,
        topLosers,
      };
    });

  }, [indexSummaries]);

  // Buffer incoming WebSocket ticks
  const handlePriceUpdate = useCallback((updates: PriceUpdate[]) => {
    for (const update of updates) {
      pendingUpdatesRef.current.set(update.symbol, update);
    }
    
    const now = Date.now();
    const timeSinceLastBatch = now - lastBatchAppliedRef.current;
    
    if (!updateTimerRef.current) {
      const delay = timeSinceLastBatch >= UPDATE_INTERVAL_MS ? 0 : UPDATE_INTERVAL_MS - timeSinceLastBatch;
      updateTimerRef.current = setTimeout(() => {
        updateTimerRef.current = null;
        applyBatchedUpdates();
      }, delay);
    }
  }, [applyBatchedUpdates]);

  // Stream Status
  const handleStreamStatusChange = useCallback((status: StreamStatus) => {
    console.log('[MarketOverview] Stream status:', status);
  }, []);

  // Web Socket Hook
  const showStreaming = isMarketOpen() && !!tokenStatus?.hasToken;
  const { status: streamStatus } = useUpstoxStream({
    enabled: showStreaming,
    onPriceUpdate: handlePriceUpdate,
    onStatusChange: handleStreamStatusChange,
  });

  const isStreaming = streamStatus === 'connected';

  // REST Refresh loop (fallback/sync)
  useEffect(() => {
    // Determine polling interval: 5 minutes if streaming is active, else 1 minute
    const pollInterval = isStreaming ? 300000 : 60000;

    dataRefreshRef.current = setInterval(() => {
      if (isMarketOpen()) {
        if (!isStreaming) loadSummaries(false);
        loadData(selectedIndex);
      }
    }, pollInterval);

    return () => {
      if (dataRefreshRef.current) clearInterval(dataRefreshRef.current);
    };
  }, [isStreaming, selectedIndex, loadData, loadSummaries]);

  // Cleanup update timer
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, []);

  const handleSelectIndex = useCallback((name: string) => {
    setSelectedIndex(name);
  }, []);

  // ... Loading Skeleton ...
  if (summariesLoading && indexSummaries.length === 0) {
    return (
      <div className="flex flex-col gap-6 pb-8 min-h-screen pt-2 animate-pulse">
        <div className="flex gap-3 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[80px] w-[140px] bg-slate-800/50 rounded-xl shrink-0" />
          ))}
        </div>
        <div className="h-[500px] bg-slate-800/50 rounded-2xl" />
        <div className="h-[80px] bg-slate-800/50 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[400px] bg-slate-800/50 rounded-2xl" />
          <div className="h-[400px] bg-slate-800/50 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <motion.main
      className="flex flex-col gap-4 md:gap-6 pb-24 md:pb-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Market Overview</h1>
            {isStreaming && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            )}
            {streamStatus === 'connecting' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-medium text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                CONNECTING
              </span>
            )}
          </div>
          {lastUpdated && (
            <p className="text-[11px] text-gray-500 mt-0.5">Last updated: {lastUpdated}</p>
          )}
        </div>
        <button
          onClick={() => { loadData(selectedIndex); loadSummaries(); }}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 border border-white/5 rounded-lg transition-all disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              Loading...
            </span>
          ) : 'Refresh'}
        </button>
      </motion.div>

      {/* Index Cards / Tabs */}
      <motion.div variants={itemVariants}>
        <IndexSummaryCards
          indices={indexSummaries}
          selectedIndex={selectedIndex}
          onSelectIndex={handleSelectIndex}
          isMobile={isMobile}
        />
      </motion.div>

      {/* Content: loading state per-index */}
      {loading && !data ? (
        <div className="flex flex-col gap-6 animate-pulse">
          <div className="h-[500px] bg-slate-800/50 rounded-2xl" />
          <div className="h-[80px] bg-slate-800/50 rounded-2xl" />
        </div>
      ) : data ? (
        <>
          {/* Index Header Stats */}
          <motion.div variants={itemVariants} className="flex items-center gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-white">{data.indexName}</span>
              {data.indexValue > 0 && (
                <>
                  <span className="text-base font-bold text-gray-200 tabular-nums">
                    {data.indexValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${data.indexChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data.indexChangePercent >= 0 ? '+' : ''}{data.indexChangePercent.toFixed(2)}%
                  </span>
                </>
              )}
            </div>
            <span className="text-xs text-gray-500">
              {data.constituents.length} stocks
            </span>
            {loading && (
              <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
          </motion.div>

          {/* Heatmap */}
          <motion.div variants={itemVariants}>
            <MarketHeatmap
              constituents={data.constituents}
              isMobile={isMobile}
            />
          </motion.div>

          {/* Advance/Decline */}
          <motion.div variants={itemVariants}>
            <AdvanceDecline
              advancing={data.advancing}
              declining={data.declining}
              unchanged={data.unchanged}
            />
          </motion.div>

          {/* Top Movers */}
          <motion.div variants={itemVariants}>
            <TopMovers
              topGainers={data.topGainers}
              topLosers={data.topLosers}
              isMobile={isMobile}
            />
          </motion.div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
          <div className="bg-amber-500/10 text-amber-400 p-6 rounded-2xl border border-amber-500/20 max-w-md">
            <h3 className="font-semibold text-lg mb-2">No Data Available</h3>
            <p className="text-sm opacity-90">
              {tokenStatus?.message || 'Could not load market data. Please check your Upstox token and try again.'}
            </p>
            <button
              onClick={() => loadData(selectedIndex)}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </motion.main>
  );
}
