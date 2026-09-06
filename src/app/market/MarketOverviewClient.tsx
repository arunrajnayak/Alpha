'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useTransition } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { fetchMarketOverview, fetchAllIndexSummaries } from '@/app/actions/market-overview';
import type { MarketOverviewData } from '@/app/actions/market-overview';
import { isMarketOpen } from '@/lib/market-status-utils';
import AdvanceDecline from '@/components/market/AdvanceDecline';
import TopMovers from '@/components/market/TopMovers';
import IndexSidebar from '@/components/market/IndexSidebar';
import { useLiveData } from '@/context/LiveDataContext';
import { PriceUpdate, StreamStatus } from '@/hooks/useUpstoxStream';
import { logger } from '@/lib/logger';

const marketLogger = logger.scope('Market');

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
  initialSummaries?: IndexSummary[];
  initialData?: MarketOverviewData | null;
  initialTokenStatus?: { hasToken: boolean; message?: string } | null;
  embedded?: boolean;
}

export default function MarketOverviewClient({
  initialSummaries = [],
  initialData = null,
  initialTokenStatus = null,
  embedded = false,
}: MarketOverviewClientProps) {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY Total Market');
  const [indexSummaries, setIndexSummaries] = useState<IndexSummary[]>(initialSummaries);
  const [data, setData] = useState<MarketOverviewData | null>(initialData);
  const [loading, setLoading] = useState(!initialData); // True when no SSR data
  const [loadError, setLoadError] = useState<string | null>(null); // Track fetch errors for display
  const [summariesLoading, setSummariesLoading] = useState(initialSummaries.length === 0);
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
      marketLogger.error('Failed to load index summaries:', err);
    } finally {
      if (showLoading) setSummariesLoading(false);
    }
  }, []);

  // Auto-fetch summaries on mount when no SSR data provided (embedded mode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialSummaries.length === 0) loadSummaries(true); }, []);

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
        marketLogger.warn(`fetchMarketOverview returned null for ${indexName}`);
        setLoadError(`Could not load data for ${indexName}. Constituent list may be unavailable.`);
      }
    } catch (err) {
      marketLogger.error(`Failed to load market data for ${indexName}:`, err);
      setLoadError(`Failed to load ${indexName} data. Please retry.`);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [updateTimestamp]);

  // Load data when index changes (skip on first mount only when SSR data was provided)
  const firstRender = useRef(initialData !== null);
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

        // Recalculate advance/decline (cheap — O(n) pass, no sort)
        let advancing = 0;
        let declining = 0;
        let unchanged = 0;
        for (const c of updatedConstituents) {
          if (c.changePercent > 0.01) advancing++;
          else if (c.changePercent < -0.01) declining++;
          else unchanged++;
        }

        // Store constituents unsorted — sorting moved to useMemo below
        return {
          ...currentData,
          indexValue: newIndexValue,
          indexChange: newIndexChange,
          indexChangePercent: newIndexChangePercent,
          constituents: updatedConstituents,
          advancing,
          declining,
          unchanged,
        };
      });
    });

    // Call updateTimestamp AFTER the transition (not inside a setState updater)
    updateTimestamp();

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
    marketLogger.info('Stream status:', status);
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
  const { streamStatus, subscribeToPrices, subscribeToInstruments, initialize, data: liveContextData } = useLiveData();
  useEffect(() => { initialize(); }, [initialize]);
  // Prefer Upstox API-driven market status; fall back to sync check if data not loaded yet
  const isMarketCurrentlyOpen = liveContextData?.marketStatus ? liveContextData.marketStatus === 'OPEN' : isMarketOpen();
  const showStreaming = isVisible && isMarketCurrentlyOpen && !!tokenStatus?.hasToken;

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

  // Sort constituents and derive movers via useMemo (React render phase, not setTimeout)
  // constituents are stored unsorted in state; sorting happens here once per render
  const sortedConstituents = useMemo(() => {
    if (!data?.constituents) return [];
    return [...data.constituents].sort((a, b) => b.changePercent - a.changePercent);
  }, [data?.constituents]);

  const streamingTopGainers = useMemo(
    () => sortedConstituents.filter(c => c.changePercent > 0).slice(0, 10),
    [sortedConstituents]
  );
  const streamingTopLosers = useMemo(() => {
    const losers = sortedConstituents.filter(c => c.changePercent < 0);
    return losers.slice(-Math.min(10, losers.length)).reverse();
  }, [sortedConstituents]);

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

  // Track API-driven market status in ref for interval callbacks
  const marketOpenRef = useRef(isMarketCurrentlyOpen);
  useEffect(() => { marketOpenRef.current = isMarketCurrentlyOpen; }, [isMarketCurrentlyOpen]);

  useEffect(() => {
    // Clear any existing interval before creating a new one
    if (dataRefreshRef.current) clearInterval(dataRefreshRef.current);

    if (isStreaming) {
      // When streaming, WebSocket drives constituent data.
      // Only sync index summaries every 60s (lightweight) for SectoralHeatmap/IndexCards.
      dataRefreshRef.current = setInterval(() => {
        if (marketOpenRef.current) {
          loadSummaries(false);
        }
      }, 60000);
    } else {
      // When NOT streaming, poll full data every 10s as fallback
      dataRefreshRef.current = setInterval(() => {
        if (marketOpenRef.current) {
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
      <div className={`flex flex-col gap-4 md:gap-6 ${embedded ? '' : 'pb-8 min-h-screen pt-2'} animate-pulse`}>
        {/* Header - standalone only */}
        {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 w-44 bg-slate-800/60 rounded-lg" />
            <div className="h-3 w-28 bg-slate-800/40 rounded mt-1.5" />
          </div>
          <div className="h-8 w-20 bg-slate-800/50 rounded-lg" />
        </div>
        )}
        {/* Sidebar + Content Skeleton */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-5">
          {/* Sidebar Skeleton */}
          <div className="hidden md:flex flex-col gap-2 w-[220px] shrink-0">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[76px] bg-slate-800/50 rounded-xl border border-white/5" />
            ))}
          </div>
          {/* Mobile pills skeleton */}
          <div className="flex md:hidden gap-2 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[52px] w-[110px] bg-slate-800/50 rounded-xl border border-white/5 shrink-0" />
            ))}
          </div>
          {/* Content Skeleton */}
          <div className="flex-1 flex flex-col gap-4 md:gap-5 min-w-0">
            {/* Heatmap card with integrated header */}
            <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
              <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="h-3 w-28 bg-slate-800/50 rounded" />
                  <div className="flex items-baseline gap-2">
                    <div className="h-6 w-20 bg-slate-800/60 rounded" />
                    <div className="h-4 w-14 bg-slate-800/40 rounded" />
                  </div>
                </div>
                <div className="flex-1 max-w-[340px] flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <div className="h-4 w-8 bg-slate-800/50 rounded" />
                    <div className="h-4 w-8 bg-slate-800/40 rounded" />
                  </div>
                  <div className="h-2.5 w-full bg-slate-800/50 rounded-full" />
                </div>
              </div>
              <div className="h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[0, 1].map(i => (
                <div key={i} className="bg-slate-900/50 rounded-2xl border border-white/5 p-5 h-[200px]" />
              ))}
            </div>
          </div>
        </div>
        {/* Sectoral Heatmap Skeleton */}
        <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
          <div className="px-5 pt-5 pb-2">
            <div className="h-3 w-36 bg-slate-800/50 rounded" />
          </div>
          <div className="h-[350px] md:h-[400px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
        </div>
      </div>
    );
  }

  // Content area (index stats + heatmap + movers) or loading/empty states
  const renderContent = () => {
    if (loading && !data) {
      return (
        <div className="flex-1 flex flex-col gap-4 md:gap-5 min-w-0 animate-pulse">
          {/* Heatmap card skeleton — stats + treemap combined */}
          <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="h-3 w-28 bg-slate-800/50 rounded" />
                <div className="flex items-baseline gap-2">
                  <div className="h-6 w-20 bg-slate-800/60 rounded" />
                  <div className="h-4 w-14 bg-slate-800/40 rounded" />
                </div>
              </div>
              <div className="flex-1 max-w-[340px] flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <div className="h-4 w-8 bg-slate-800/50 rounded" />
                  <div className="h-4 w-8 bg-slate-800/40 rounded" />
                </div>
                <div className="h-2.5 w-full bg-slate-800/50 rounded-full" />
              </div>
            </div>
            <div className="h-[400px] md:h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
          </div>
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

    if (data) {
      return (
        <div className="flex-1 flex flex-col gap-4 md:gap-5 min-w-0">
          {/* Mobile-only compact stats row (heatmap is hidden on mobile, so stats still need to be shown) */}
          {isMobile && (
            <motion.div
              variants={itemVariants}
              className="flex flex-col gap-2.5 bg-slate-900/50 border border-white/5 rounded-2xl p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
                  {data.indexName}
                </span>
                {data.indexValue > 0 && (
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-base font-bold text-gray-100 tabular-nums">
                      {data.indexValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        data.indexChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-500'
                      }`}
                    >
                      {data.indexChangePercent >= 0 ? '+' : ''}
                      {data.indexChangePercent.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
              <AdvanceDecline
                advancing={data.advancing}
                declining={data.declining}
                unchanged={data.unchanged}
              />
            </motion.div>
          )}

          {/* Heatmap — stats integrated into card header on desktop */}
          {!isMobile && (
            <motion.div variants={itemVariants}>
              {loading && data.indexName !== selectedIndex ? (
                /* Skeleton while switching index — prevents Nivo layout animation distortion */
                <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 animate-pulse">
                  <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="h-3 w-28 bg-slate-800/50 rounded" />
                      <div className="flex items-baseline gap-2">
                        <div className="h-6 w-20 bg-slate-800/60 rounded" />
                        <div className="h-4 w-14 bg-slate-800/40 rounded" />
                      </div>
                    </div>
                    <div className="flex-1 max-w-[340px] flex flex-col gap-1.5">
                      <div className="flex justify-between">
                        <div className="h-4 w-8 bg-slate-800/50 rounded" />
                        <div className="h-4 w-8 bg-slate-800/40 rounded" />
                      </div>
                      <div className="h-2.5 w-full bg-slate-800/50 rounded-full" />
                    </div>
                  </div>
                  <div className="h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
                </div>
              ) : (
                /* key forces full remount when index changes — prevents stale Nivo layout animation */
                <MarketHeatmap
                  key={data.indexName}
                  constituents={sortedConstituents}
                  isMobile={isMobile}
                  indexName={data.indexName}
                  indexValue={data.indexValue}
                  indexChangePercent={data.indexChangePercent}
                  advancing={data.advancing}
                  declining={data.declining}
                  unchanged={data.unchanged}
                  loading={loading}
                  onRefresh={() => { loadData(selectedIndex); loadSummaries(false); }}
                />
              )}
            </motion.div>
          )}

          {/* Top Movers */}
          <motion.div variants={itemVariants}>
            <TopMovers
              topGainers={isStreaming ? streamingTopGainers : data.topGainers}
              topLosers={isStreaming ? streamingTopLosers : data.topLosers}
              totalConstituents={data.constituents.length}
              isMobile={isMobile}
            />
          </motion.div>
        </div>
      );
    }

    // No data state
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
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
    );
  };

  const Container = embedded ? motion.div : motion.main;

  return (
    <Container
      className={`flex flex-col gap-4 md:gap-6 ${embedded ? '' : 'pb-24 md:pb-8'}`}
      variants={containerVariants}
      initial={embedded ? false : "hidden"}
      animate="visible"
    >
      {/* Header — standalone only */}
      {!embedded && (
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap">
              <span className="gradient-text">Market Overview</span>
            </h1>
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
      )}

      {/* Error Banner */}
      {loadError && (
        <motion.div variants={itemVariants} className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
          <span>{loadError}</span>
        </motion.div>
      )}

      {/* Sidebar + Content — horizontal layout on desktop, vertical on mobile */}
      <motion.div variants={itemVariants} className="flex flex-col md:flex-row gap-4 md:gap-5">
        {/* Index Sidebar */}
        <IndexSidebar
          indices={indexSummaries}
          selectedIndex={selectedIndex}
          onSelectIndex={handleSelectIndex}
          isMobile={isMobile}
        />

        {/* Main Content */}
        {renderContent()}
      </motion.div>

      {/* Sectoral Heatmap — full width, below the sidebar+content area */}
      {indexSummaries.length > 0 && (
        <motion.div variants={itemVariants}>
          <SectoralHeatmap
            indices={indexSummaries}
            isMobile={isMobile}
          />
        </motion.div>
      )}
    </Container>
  );
}
