'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLiveData } from '@/context/LiveDataContext';
import type { LiveDashboardData } from '@/app/actions/live';
import { formatNumber } from '@/lib/format';
import { motion, MotionConfig, type Variants } from 'framer-motion';
import dynamic from 'next/dynamic';
import { LiveHeader, LiveStatsCards, LiveMovers, PerformanceRank, IntradayPnLChart, LiveStockDynamicsTable } from '@/components/live';
import { saveOrShareImage, haptic, hapticNotification } from '@/lib/mobile';
import { Snackbar, Alert, Dialog } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faShareNodes } from '@fortawesome/free-solid-svg-icons';

const PortfolioHeatmap = dynamic(() => import('@/components/portfolio/PortfolioHeatmap'), {
  loading: () => <div className="h-[400px] bg-slate-800/50 rounded-2xl animate-pulse" />,
  ssr: false
});

const viewportConfig = {
  once: true,
  amount: 0.1,
  margin: '0px 0px -40px 0px',
};

interface LivePageClientProps {
  initialData?: LiveDashboardData | null;
}

export default function LivePageClient({ initialData = null }: LivePageClientProps) {
  const {
    data: liveContextData,
    prevData,
    loading: liveContextLoading,
    lastRefreshed,
    refresh: fetchData,
    initialize,
    hasAnimatedInitial,
    setHasAnimatedInitial,
    connectionError,
    pnlHistory,
    privacyMode,
  } = useLiveData();

  const data = liveContextData || initialData || null;
  const loading = liveContextLoading && !data;

  useEffect(() => {
    initialize({ bootstrapData: initialData });
  }, [initialize, initialData]);

  // Use Upstox API-driven market status from server instead of hardcoded hours
  const marketOpen = data?.marketStatus === 'OPEN';
  const [downloading, setDownloading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'info' });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // When downloading snapshot, collapse animations to duration 0 and clear staggers
  const containerVariants: Variants = useMemo(() => ({
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: downloading
        ? { duration: 0, staggerChildren: 0 }
        : { staggerChildren: 0.1 }
    }
  }), [downloading]);

  const itemVariants: Variants = useMemo(() => ({
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: downloading
        ? { duration: 0 }
        : { duration: 0.5, ease: "easeOut" as const }
    }
  }), [downloading]);

  const handleDownloadSnapshot = useCallback(async () => {
    setDownloading(true);
    haptic('light');
    try {
      // 1. Wait for React to flush state updates to DOM
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 2. Wait for web fonts to be fully loaded (with 1.5s timeout safety)
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }

      // 3. Double requestAnimationFrame to ensure browser has recalculated styles & painted
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const element = document.getElementById('live-dashboard-content');
      const marketOverview = document.getElementById('market-overview');
      const intradayDynamics = document.getElementById('intraday-dynamics');
      if (element) {
        const { toPng } = await import('html-to-image');
        // Hide market-overview and intraday dynamics via display:none so they are excluded from layout/height
        if (marketOverview) marketOverview.style.display = 'none';
        if (intradayDynamics) intradayDynamics.style.display = 'none';
        const contentHeight = element.scrollHeight;
        const contentWidth = element.scrollWidth;

        const captureOptions = {
          cacheBust: true,
          quality: 0.95,
          pixelRatio: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2, 2),
          height: contentHeight,
          width: contentWidth,
          backgroundColor: '#0f172a',
          filter: (node: Node) => {
            if (node instanceof HTMLElement) {
              if (node.id === 'market-overview' || node.id === 'intraday-dynamics') {
                return false;
              }
              if (node.classList?.contains('snapshot-hide')) {
                return false;
              }
            }
            return true;
          },
        };

        let dataUrl: string;
        try {
          dataUrl = await toPng(element, captureOptions);
        } catch (captureErr) {
          console.warn('Initial toPng failed, retrying with skipFonts: true', captureErr);
          dataUrl = await toPng(element, { ...captureOptions, skipFonts: true });
        }

        if (marketOverview) marketOverview.style.display = '';
        if (intradayDynamics) intradayDynamics.style.display = '';

        const fileName = `market-dashboard-${new Date().toISOString().split('T')[0]}.png`;
        const result = await saveOrShareImage(dataUrl, fileName, 'Alpha Market Dashboard');

        if (result.success) {
          if (result.method === 'capacitor-share') {
            hapticNotification('success');
            setSnackbar({
              open: true,
              message: 'Dashboard snapshot shared successfully!',
              severity: 'success',
            });
          }
        } else if (result.method === 'preview') {
          setPreviewImage(dataUrl);
        } else {
          setSnackbar({
            open: true,
            message: result.error || 'Failed to save snapshot',
            severity: 'error',
          });
        }
      }
    } catch (err) {
      console.error('Failed to capture snapshot:', err);
      hapticNotification('error');
      setSnackbar({
        open: true,
        message: 'Failed to capture snapshot. Please try again.',
        severity: 'error',
      });
    } finally {
      const marketOverview = document.getElementById('market-overview');
      const intradayDynamics = document.getElementById('intraday-dynamics');
      if (marketOverview) marketOverview.style.display = '';
      if (intradayDynamics) intradayDynamics.style.display = '';
      setDownloading(false);
    }
  }, []);

  if (loading && !data) {
     return (
       <div className="flex flex-col gap-4 md:gap-8 pb-8 md:pb-0 min-h-screen pt-4 animate-pulse">
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
    <MotionConfig
      reducedMotion={downloading ? "always" : "user"}
      transition={downloading ? { duration: 0 } : undefined}
    >
      <main
        id="live-dashboard-content"
        data-downloading={downloading ? "true" : undefined}
        className={`flex flex-col gap-4 md:gap-8 pb-24 md:pb-8 ${downloading ? 'snapshot-capturing' : ''}`}
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
            downloading={downloading}
        />

        {/* Portfolio Heatmap */}
        {data.allHoldings && data.allHoldings.length > 0 && (
          <motion.div
            variants={itemVariants}
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            animate={downloading ? "visible" : undefined}
            data-motion-section
          >
            <PortfolioHeatmap 
                data={{ allHoldings: data.allHoldings.map(h => ({ ...h, formattedValue: formatNumber(h.currentValue, 0, 0) })) }} 
                isMobile={isMobile} 
                privacyMode={privacyMode} 
                downloading={downloading}
            />
          </motion.div>
        )}

        {/* Intraday Dynamics Table */}
        {data.allHoldings && data.allHoldings.length > 0 && (
          <LiveStockDynamicsTable
            id="intraday-dynamics"
            holdings={data.allHoldings}
            lastRefreshed={lastRefreshed}
            marketStatus={data.marketStatus}
            privacyMode={privacyMode}
            isMobile={isMobile}
            downloading={downloading}
            itemVariants={itemVariants}
          />
        )}

        {/* Bottom Section: Movers + Performance Rank */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={viewportConfig}
          animate={downloading ? "visible" : undefined}
          data-motion-section
        >
            <LiveMovers
                topGainers={data.topGainers}
                topLosers={data.topLosers}
                privacyMode={privacyMode}
                isMobile={isMobile}
                itemVariants={itemVariants}
                downloading={downloading}
            />
            <PerformanceRank
                dayGainPercent={data.dayGainPercent}
                indices={data.indices}
                itemVariants={itemVariants}
                downloading={downloading}
            />
        </motion.div>
      </main>

      <style jsx global>{`
        .snapshot-capturing [data-motion-section],
        .snapshot-capturing [data-motion-item] {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
          animation: none !important;
        }
        .snapshot-capturing * {
          animation-play-state: paused !important;
          transition-duration: 0s !important;
        }
        .snapshot-capturing #intraday-dynamics {
          display: none !important;
        }
        .snapshot-capturing .snapshot-hide {
          opacity: 0 !important;
          visibility: hidden !important;
        }
      `}</style>

      {/* Snapshot Preview Dialog (Fallback / Mobile View) */}
      {previewImage && (
        <Dialog
          open={!!previewImage}
          onClose={() => setPreviewImage(null)}
          maxWidth="md"
          fullWidth
          slotProps={{
            paper: {
              className: 'bg-slate-900 border border-white/10 rounded-2xl text-white p-4 max-h-[90vh] shadow-2xl',
            },
          }}
        >
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Dashboard Snapshot</span>
            </h3>
            <button
              onClick={() => setPreviewImage(null)}
              className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            >
              <FontAwesomeIcon icon={faXmark} className="text-base" />
            </button>
          </div>

          <div className="py-4 flex flex-col items-center gap-3 overflow-y-auto">
            <div className="w-full max-h-[60vh] overflow-auto rounded-xl border border-white/10 bg-slate-950 flex items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImage}
                alt="Dashboard Snapshot"
                className="max-w-full h-auto object-contain rounded-lg shadow-lg"
              />
            </div>
            <p className="text-xs text-gray-400 text-center">
              💡 <span className="font-medium text-gray-300">Tip:</span> Long-press the image to save or share it directly to your photos or messaging apps.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
            <button
              onClick={() => setPreviewImage(null)}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-gray-300 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={async () => {
                const fileName = `market-dashboard-${new Date().toISOString().split('T')[0]}.png`;
                await saveOrShareImage(previewImage, fileName, 'Alpha Market Dashboard');
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <FontAwesomeIcon icon={faShareNodes} />
              <span>Share / Save</span>
            </button>
          </div>
        </Dialog>
      )}

      {/* Snapshot Toast Feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%', borderRadius: '12px' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </MotionConfig>
  );
}
