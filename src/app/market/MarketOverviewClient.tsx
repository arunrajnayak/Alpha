'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useTransition } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { fetchMarketOverview, fetchAllIndexSummaries } from '@/app/actions/market-overview';
import type { MarketOverviewData } from '@/app/actions/market-overview';
import { isMarketOpen } from '@/lib/market-status-utils';
import AdvanceDecline from '@/components/market/AdvanceDecline';
import TopMovers from '@/components/market/TopMovers';
import IndexSummaryCards from '@/components/market/IndexSummaryCards';
import { useLiveData } from '@/context/LiveDataContext';
import { PriceUpdate, StreamStatus } from '@/hooks/useUpstoxStream';

const SectoralHeatmap = dynamic(() => import('@/components/market/SectoralHeatmap'), {
  loading: () => <div className="h-[400px] bg-slate-800/50 rounded-2xl animate-pulse" />,
  ssr: false,
});

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

const UPDATE_INTERVAL_MS = 5000; // Batch UI updates every 5 seconds (matches Live page)

interface MarketOverviewClientProps {
  initialSummaries: IndexSummary[];
  initialData: MarketOverviewData | null;
  initialTokenStatus: { hasToken: boolean; message?: string } | null;
}

export default function MarketOverviewClient({
  initialSummaries,
  initialData,
  initialTokenStatus
}: MarketOverviewClientProps) {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY 50');
  const [indexSummaries, setIndexSummaries] = useState<IndexSummary[]>(initialSummaries);
  const [data, setData] = useState<MarketOverviewData | null>(initialData);
  const [loading, setLoading] = useState(false); // Default false since we have SSR data
  const [loadError, setLoadError] = useState<string | null>(null); // Track fetch errors for display
  const [summariesLoading, setSummariesLoading] = useState(false); // Default false
  const [isMobile, setIsMobile] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  
  const [tokenStatus, setTokenStatus] = useState<{ hasToken: boolean; message?: string } | null>(initialTokenStatus);
  
  // Refresh timers
  const dataRefreshRef = useRef<NodeJS.Timeout | null>(null);

  // Streaming buffers
  const pendingUpdatesRef = useRef<Map<string, PriceUpdate>>(new Map());
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBatchAppliedRef = useRef<number>(0);

  // Refs for avoiding stale closures and unnecessary effect restarts
  const isVisibleRef = useRef(true);
  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

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

  // Initial timestamp set
  useEffect(() => {
    if (!lastUpdated) updateTimestamp();
  }, [lastUpdated, updateTimestamp]);

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
  const loadData = useCallback(async (indexName: string, showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setLoadError(null);
      const result = await fetchMarketOverview(indexName);
      if (result) {
        // Success — clear any previous error
        setLoadError(null);
        setData(result);
        updateTimestamp();
        if (result.tokenStatus) {
          setTokenStatus(result.tokenStatus);
        }
      } else {
        // fetchMarketOverview returned null — likely constituent CSV failed to load
        // or all Upstox API batches failed. Show error but keep old data visible.
        console.warn(`[MarketOverview] fetchMarketOverview returned null for ${indexName}`);
        setLoadError(`Could not load data for ${indexName}. Constituent list may be unavailable.`);
      }
    } catch (err) {
      console.error(`Failed to load market data for ${indexName}:`, err);
      setLoadError(`Failed to load ${indexName} data. Please retry.`);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [updateTimestamp]);

  // Load data when index changes (skip on first mount as we have SSR data)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    loadData(selectedIndex);
  }, [selectedIndex, loadData]);

  // Keep a ref to indexSummaries to avoid stale closures in applyBatchedUpdates
  const indexSummariesRef = useRef(indexSummaries);
  useEffect(() => {
    indexSummariesRef.current = indexSummaries;
  }, [indexSummaries]);

  // Handle batched streaming updates to avoid UI stutter
  // Wrapped in startTransition so streaming updates don't block user interactions
  const applyBatchedUpdates = useCallback(() => {
    const updates = pendingUpdatesRef.current;
    if (updates.size === 0) return;

    // Swap out pending map atomically — no need to copy
    const updateMap = updates;
    pendingUpdatesRef.current = new Map();
    lastBatchAppliedRef.current = Date.now();

    startTransition(() => {
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

        // Use ref to avoid stale closure — read current summaries
        const currentSummaries = indexSummariesRef.current;
        const selectedIndexSummaryUpdate = Array.from(updateMap.values()).find(
          u => currentSummaries.find(s => s.name === currentData.indexName && s.instrumentKey === u.symbol)
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
        // sorted is DESC — losers sit at the tail. Slice the last 10, then reverse so biggest loser is first.
        const losersArr = sorted.filter(c => c.changePercent < 0);
        const topLosers = losersArr.slice(-Math.min(10, losersArr.length)).reverse();

        updateTimestamp();

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
    });

  }, [updateTimestamp, startTransition]); // No stale dependencies — uses refs for external state

  // Heatmap throttle removed — with 5s batching, data.constituents only changes every 5s
  // so the TreeMap naturally re-renders at the right cadence without a separate throttle.

  // Buffer incoming WebSocket ticks — skip when tab is hidden
  const handlePriceUpdate = useCallback((updates: PriceUpdate[]) => {
    if (!isVisibleRef.current) return; // Don't buffer when tab is hidden

    for (const update of updates) {
      pendingUpdatesRef.current.set(update.symbol, update);
      if (update.instrumentKey) {
        pendingUpdatesRef.current.set(update.instrumentKey, update);
      }
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

  const [isVisible, setIsVisible] = useState(true);

  // Monitor tab visibility — flush pending updates when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = !document.hidden;
      setIsVisible(visible);
      isVisibleRef.current = visible;
      // Flush any pending updates when tab becomes visible again
      if (visible && pendingUpdatesRef.current.size > 0) {
        applyBatchedUpdates();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [applyBatchedUpdates]);

  // Web Socket Hook - use the shared stream from LiveDataContext
  const { streamStatus, subscribeToPrices, subscribeToInstruments } = useLiveData();
  const showStreaming = isVisible && isMarketOpen() && !!tokenStatus?.hasToken;

  useEffect(() => {
    if (showStreaming) {
      return subscribeToPrices(handlePriceUpdate);
    }
  }, [showStreaming, subscribeToPrices, handlePriceUpdate]);

  // Stable subscription key — only changes when the actual set of instruments changes
  // (i.e. on index switch), NOT on every streaming price update
  const constituentSubscriptionKey = useMemo(() => {
    if (!data?.constituents) return '';
    return data.constituents.map(c => c.instrumentKey).sort().join(',');
  }, [data?.constituents]);

  useEffect(() => {
    if (showStreaming && data && data.constituents.length > 0) {
      subscribeToInstruments(
        data.constituents.map(c => ({
          instrumentKey: c.instrumentKey,
          symbol: c.symbol,
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStreaming, constituentSubscriptionKey, subscribeToInstruments]);

  const isStreaming = streamStatus === 'connected';

  // REST Refresh loop — smart polling based on streaming status
  // Uses refs for selectedIndex and isStreaming so the interval doesn't restart on every change
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  useEffect(() => {
    // Clear any existing interval before creating a new one
    if (dataRefreshRef.current) clearInterval(dataRefreshRef.current);

    if (isStreaming) {
      // When streaming, WebSocket drives constituent data.
      // Only sync index summaries every 60s (lightweight) for SectoralHeatmap/IndexCards.
      dataRefreshRef.current = setInterval(() => {
        if (isMarketOpen()) {
          loadSummaries(false);
        }
      }, 60000);
    } else {
      // When NOT streaming, poll full data every 10s as fallback
      dataRefreshRef.current = setInterval(() => {
        if (isMarketOpen()) {
          loadSummaries(false);
          loadData(selectedIndexRef.current, false);
        }
      }, 10000);
    }

    return () => {
      if (dataRefreshRef.current) {
        clearInterval(dataRefreshRef.current);
        dataRefreshRef.current = null;
      }
    };
  }, [isStreaming, loadData, loadSummaries]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, []);

  const handleSelectIndex = useCallback((name: string) => {
    setSelectedIndex(name);
  }, []);

  // ... Loading Skeleton (full page initial load) ...
  if (summariesLoading && indexSummaries.length === 0) {
    return (
      <div className="flex flex-col gap-4 md:gap-6 pb-8 min-h-screen pt-2 animate-pulse">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 w-44 bg-slate-800/60 rounded-lg" />
            <div className="h-3 w-28 bg-slate-800/40 rounded mt-1.5" />
          </div>
          <div className="h-8 w-20 bg-slate-800/50 rounded-lg" />
        </div>
        {/* Sectoral Heatmap Skeleton */}
        <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
          <div className="px-5 pt-5 pb-2">
            <div className="h-3 w-32 bg-slate-800/50 rounded" />
          </div>
          <div className="h-[350px] md:h-[400px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
        </div>
        {/* Index Card Grid Skeleton */}
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="h-[68px] bg-slate-800/50 rounded-xl border border-white/5" />
          ))}
        </div>
        {/* Index Stats Bar Skeleton */}
        <div className="h-[56px] bg-slate-900/40 rounded-2xl border border-white/5" />
        {/* Heatmap Skeleton */}
        <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
          <div className="px-5 pt-5 pb-2">
            <div className="h-3 w-28 bg-slate-800/50 rounded" />
          </div>
          <div className="h-[400px] md:h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
        </div>
        {/* Top Movers Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="bg-slate-900/50 rounded-2xl border border-white/5 p-5">
              <div className="h-4 w-24 bg-slate-800/50 rounded mb-4" />
              <div className="flex flex-col gap-3">
                {[...Array(5)].map((_, j) => (
                  <div key={j} className="flex justify-between items-center">
                    <div className="h-3.5 w-20 bg-slate-800/40 rounded" />
                    <div className="h-5 w-14 bg-slate-800/40 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
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

      {/* Error Banner — shown when loadData fails (e.g. Microcap 250 CSV unavailable) */}
      {loadError && (
        <motion.div variants={itemVariants} className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span>{loadError}</span>
        </motion.div>
      )}

      {/* Sectoral Heatmap */}
      {indexSummaries.length > 0 && (
        <motion.div variants={itemVariants}>
          <SectoralHeatmap
            indices={indexSummaries}
            isMobile={isMobile}
          />
        </motion.div>
      )}

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
        <div className="flex flex-col gap-4 md:gap-6 animate-pulse">
          {/* Index Stats Bar Skeleton */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8 bg-slate-900/40 border border-white/5 rounded-2xl p-4 sm:px-5 sm:py-3.5">
            <div className="flex items-center gap-3">
              <div className="h-5 w-28 bg-slate-800/60 rounded" />
              <div className="h-5 w-20 bg-slate-800/50 rounded" />
              <div className="h-5 w-16 bg-slate-800/40 rounded" />
            </div>
            <div className="flex-1 flex justify-end">
              <div className="h-4 w-48 bg-slate-800/40 rounded-full" />
            </div>
          </div>
          {/* Heatmap Skeleton */}
          <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
            <div className="px-5 pt-5 pb-2">
              <div className="h-3 w-28 bg-slate-800/50 rounded" />
            </div>
            <div className="h-[400px] md:h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
          </div>
          {/* Top Movers Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, 1].map(i => (
              <div key={i} className="bg-slate-900/50 rounded-2xl border border-white/5 p-5">
                <div className="h-4 w-24 bg-slate-800/50 rounded mb-4" />
                <div className="flex flex-col gap-3">
                  {[...Array(5)].map((_, j) => (
                    <div key={j} className="flex justify-between items-center">
                      <div className="h-3.5 w-20 bg-slate-800/40 rounded" />
                      <div className="h-5 w-14 bg-slate-800/40 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : data ? (
        <>
          {/* Index Header Stats */}
          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 bg-slate-900/40 border border-white/5 rounded-2xl p-4 sm:px-5 sm:py-3.5">
            <div className="flex flex-col shrink-0 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-extrabold text-white tracking-tight truncate">{data.indexName}</span>
                {loading && (
                  <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              {data.indexValue > 0 && (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-xl sm:text-2xl font-bold text-gray-100 tabular-nums">
                    {data.indexValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                  <span className={`text-sm sm:text-base font-bold tabular-nums ${data.indexChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {data.indexChangePercent >= 0 ? '+' : ''}{data.indexChangePercent.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            <div className="w-full sm:flex-1 min-w-0 flex items-center justify-end">
              <AdvanceDecline
                advancing={data.advancing}
                declining={data.declining}
                unchanged={data.unchanged}
              />
            </div>
          </motion.div>

          {/* Heatmap — updates every 5s via batched WebSocket ticks */}
          {!isMobile && (
            <motion.div variants={itemVariants}>
              <MarketHeatmap
                constituents={data.constituents}
                isMobile={isMobile}
              />
            </motion.div>
          )}

          {/* Top Movers */}
          <motion.div variants={itemVariants}>
            <TopMovers
              topGainers={data.topGainers}
              topLosers={data.topLosers}
              totalConstituents={data.constituents.length}
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
