'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLiveData } from '@/context/LiveDataContext';
import { formatNumber } from '@/lib/format';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { LiveHeader, LiveStatsCards, LiveMovers, PerformanceRank, IntradayPnLChart } from '@/components/live';
import ShimmerText from '@/components/ui/ShimmerText';

const PortfolioHeatmap = dynamic(() => import('@/components/portfolio/PortfolioHeatmap'), {
  loading: () => (
    <div className="relative h-[400px] rounded-2xl border border-white/5 overflow-hidden">
      <div className="absolute inset-0 bg-slate-800/50 animate-pulse" />
      <div className="absolute inset-0 flex items-center justify-center">
        <ShimmerText withDot>Rendering portfolio heatmap…</ShimmerText>
      </div>
    </div>
  ),
  ssr: false
});

const MarketOverviewSection = dynamic(() => import('./market/MarketOverviewClient'), {
  loading: () => (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col md:flex-row gap-4 md:gap-5">
        <div className="hidden md:flex flex-col gap-2 w-[220px] shrink-0 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[76px] bg-slate-800/50 rounded-xl border border-white/5" />
          ))}
        </div>
        <div className="flex-1 relative">
          <div className="h-[500px] bg-slate-800/50 rounded-2xl border border-white/5 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <ShimmerText withDot>Loading market overview…</ShimmerText>
          </div>
        </div>
      </div>
    </div>
  ),
  ssr: false,
});

// Animation variants - extracted for reuse
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } }
};

export default function LivePage() {
  const {
    data,
    prevData,
    loading,
    lastRefreshed,
    refresh: fetchData,
    initialize,
    hasAnimatedInitial,
    setHasAnimatedInitial,
    connectionError,
    pnlHistory,
    privacyMode,
  } = useLiveData();

  useEffect(() => { initialize(); }, [initialize]);

  // Use Upstox API-driven market status from server instead of hardcoded hours
  const marketOpen = data?.marketStatus === 'OPEN';
  const [downloading, setDownloading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleDownloadSnapshot = useCallback(async () => {
    setDownloading(true);
    try {
      // Small delay to ensure UI updates before capture (e.g. hiding buttons)
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = document.getElementById('live-dashboard-content');
      const marketOverview = document.getElementById('market-overview');
      if (element) {
        const { toPng } = await import('html-to-image');
        // Hide market-overview via display:none so it's excluded from layout/height
        if (marketOverview) marketOverview.style.display = 'none';
        const contentHeight = element.scrollHeight;
        const contentWidth = element.scrollWidth;
        const dataUrl = await toPng(element, {
          cacheBust: true,
          quality: 0.95,
          pixelRatio: 2,
          height: contentHeight,
          width: contentWidth,
          backgroundColor: '#0f172a',
        });
        if (marketOverview) marketOverview.style.display = '';

        const link = document.createElement('a');
        link.download = `market-dashboard-${new Date().toISOString().split('T')[0]}.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error('Failed to capture snapshot:', err);
    } finally {
      setDownloading(false);
    }
  }, []);

  if (loading && !data) {
     // ... (keeping loading check)
     return (
       <div className="flex flex-col gap-4 md:gap-8 pb-8 md:pb-0 min-h-screen pt-4 animate-pulse">
         {/* ... preserved loading skeleton ... */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="h-10 w-48 bg-slate-800/50 rounded-xl"></div>
                <div className="flex items-center gap-2 bg-slate-800/40 border border-white/5 rounded-2xl p-1.5 min-w-[120px]">
                    <div className="h-8 w-24 bg-slate-800/50 rounded-lg hidden md:block mr-1"></div>
                    <div className="flex gap-1.5">
                        <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
                        <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
                        <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
                    </div>
                </div>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="h-[160px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
            ))}
        </div>
        <div className="h-[400px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {[...Array(3)].map((_, i) => (
                <div key={i} className="h-[300px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
            ))}
        </div>
       </div>
     );
  }

  if (!data) {
    if (connectionError) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
                <div className="bg-red-500/10 text-red-400 p-4 rounded-2xl border border-red-500/20 max-w-md">
                    <h3 className="font-semibold text-lg mb-2">Connection Error</h3>
                    <p className="text-sm opacity-90 mb-4">{connectionError.message}</p>
                    <button 
                        onClick={() => { window.location.reload(); }}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
                    >
                        Reload Page
                    </button>
                </div>
            </div>
        );
    }
    return null; 
  }

  return (
    <motion.main
      id="live-dashboard-content"
      className="flex flex-col gap-4 md:gap-8 pb-24 md:pb-8"
      variants={containerVariants}
      initial={false}
      animate="visible"
    >
        {/* Header Section */}
        <LiveHeader
            marketOpen={marketOpen}
            lastRefreshed={lastRefreshed}
            loading={loading}
            downloading={downloading}
            isMobile={isMobile}
            onRefresh={fetchData}
            onDownloadSnapshot={handleDownloadSnapshot}
            itemVariants={itemVariants}
            marketStatus={data.marketStatus}
            dataDate={data.dataDate}
        />

        {/* Stats Cards */}
        <LiveStatsCards
            data={data}
            prevData={prevData}
            hasAnimatedInitial={hasAnimatedInitial}
            setHasAnimatedInitial={setHasAnimatedInitial}
            downloading={downloading}
            privacyMode={privacyMode}
            isMobile={isMobile}
            itemVariants={itemVariants}
            containerVariants={containerVariants}
        />

        {/* Intraday P/L Chart */}
        <IntradayPnLChart
            data={pnlHistory}
            itemVariants={itemVariants}
            privacyMode={privacyMode}
            isMobile={isMobile}
        />

        {/* Portfolio Heatmap */}
        {data.allHoldings && data.allHoldings.length > 0 && (
          <motion.div variants={itemVariants}>
            <PortfolioHeatmap 
                data={{ allHoldings: data.allHoldings.map(h => ({ ...h, formattedValue: formatNumber(h.currentValue, 0, 0) })) }} 
                isMobile={isMobile} 
                privacyMode={privacyMode} 
            />
          </motion.div>
        )}

        {/* Bottom Section: Movers + Performance Rank */}
        <motion.div className="grid grid-cols-1 lg:grid-cols-3 gap-8" variants={containerVariants}>
            <LiveMovers
                topGainers={data.topGainers}
                topLosers={data.topLosers}
                privacyMode={privacyMode}
                isMobile={isMobile}
                itemVariants={itemVariants}
            />
            <PerformanceRank
                dayGainPercent={data.dayGainPercent}
                indices={data.indices}
                itemVariants={itemVariants}
            />
        </motion.div>

        {/* Market Overview Section */}
        <motion.div variants={itemVariants} id="market-overview" className="pt-4 md:pt-6">
          <div className="flex items-center gap-3 mb-4 md:mb-6">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <h2 className="text-lg md:text-xl font-bold whitespace-nowrap">
              <span className="gradient-text">Market Overview</span>
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
          <MarketOverviewSection embedded />
        </motion.div>
    </motion.main>
  );
}
