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
  value: number;
  change: number;
  changePercent: number;
}

export default function MarketOverviewPage() {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY 50');
  const [indexSummaries, setIndexSummaries] = useState<IndexSummary[]>([]);
  const [data, setData] = useState<MarketOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Responsive check
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Fetch index summaries
  const loadSummaries = useCallback(async () => {
    try {
      setSummariesLoading(true);
      const summaries = await fetchAllIndexSummaries();
      if (summaries.length > 0) {
        setIndexSummaries(summaries);
      }
    } catch (err) {
      console.error('Failed to load index summaries:', err);
    } finally {
      setSummariesLoading(false);
    }
  }, []);

  // Fetch data for selected index
  const loadData = useCallback(async (indexName: string) => {
    try {
      setLoading(true);
      const result = await fetchMarketOverview(indexName);
      if (result) {
        setData(result);
        setLastUpdated(new Date().toLocaleTimeString('en-IN', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }));
      }
    } catch (err) {
      console.error(`Failed to load market data for ${indexName}:`, err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  // Load data when index changes
  useEffect(() => {
    loadData(selectedIndex);
  }, [selectedIndex, loadData]);

  // Auto-refresh every 30s during market hours
  useEffect(() => {
    const startRefresh = () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      
      refreshTimerRef.current = setInterval(() => {
        if (isMarketOpen()) {
          loadData(selectedIndex);
          loadSummaries();
        }
      }, 30000);
    };

    startRefresh();
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [selectedIndex, loadData, loadSummaries]);

  const handleSelectIndex = useCallback((name: string) => {
    setSelectedIndex(name);
  }, []);

  // Loading skeleton
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
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Market Overview</h1>
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
              Could not load market data. Please check your Upstox token and try again.
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
