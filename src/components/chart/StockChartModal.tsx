'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import { IconButton } from '@mui/material';
import {
  CandleData,
  CandleBarStats,
  TradeMarker,
  ChartInterval,
  ChartPeriod,
  DEFAULT_RIGHT_OFFSET,
  loadChartPreferences,
  saveChartPreferences,
} from '@/lib/chart-types';
import { getStockCandles, getStockTrades, getStockInfo } from '@/app/actions/chart';
import ChartControls from './ChartControls';
import { VisibleIndicators, IndicatorValues } from './TradingViewChart';

const TradingViewChart = dynamic(() => import('./TradingViewChart'), {
  loading: () => (
    <div className="h-full min-h-[380px] bg-slate-900/60 rounded-xl animate-pulse flex items-center justify-center text-gray-500 text-sm">
      Loading chart...
    </div>
  ),
  ssr: false,
});

export interface HoldingSummary {
  symbol: string;
  currentValue?: number;
  dayChangePercent?: number;
  dayChange?: number;
  currentPrice?: number;
  marketCapCategory?: string;
  sector?: string;
  formattedValue?: string;
  totalPnlPercent?: number;
}

interface StockChartModalProps {
  symbol: string | null;
  isOpen: boolean;
  onClose: () => void;
  holding?: HoldingSummary | null;
  privacyMode?: boolean;
}

function StockChartModalContent({
  symbol,
  onClose,
  holding,
}: {
  symbol: string;
  onClose: () => void;
  holding?: HoldingSummary | null;
  privacyMode?: boolean;
}) {
  const [initialPrefs] = useState(() => loadChartPreferences());
  const [interval, setInterval] = useState<ChartInterval>(initialPrefs.interval);
  const [period, setPeriod] = useState<ChartPeriod | null>(() => {
    if (initialPrefs.barSpacingByInterval?.[initialPrefs.interval]) {
      return initialPrefs.periodByInterval?.[initialPrefs.interval] ?? null;
    }
    return initialPrefs.periodByInterval?.[initialPrefs.interval] ?? initialPrefs.period ?? null;
  });
  const [visibleIndicators, setVisibleIndicators] = useState<VisibleIndicators>(initialPrefs.visibleIndicators);
  const [isLogScale, setIsLogScale] = useState<boolean>(() => initialPrefs.isLogScale ?? false);
  const [resetZoomTrigger, setResetZoomTrigger] = useState(0);

  const handleToggleLogScale = useCallback(() => {
    setIsLogScale(prev => {
      const next = !prev;
      saveChartPreferences({ isLogScale: next });
      return next;
    });
  }, []);

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [trades, setTrades] = useState<TradeMarker[]>([]);
  const [stockInfo, setStockInfo] = useState<{
    symbol: string;
    currentPrice?: number;
    change?: number;
    changePercent?: number;
    inPortfolio: boolean;
    quantity?: number;
    invested?: number;
    pnl?: number;
    pnlPercent?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const hasMoreOlderRef = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [indicatorValues, setIndicatorValues] = useState<IndicatorValues>({});
  const [hoveredIndicator, setHoveredIndicator] = useState<keyof VisibleIndicators | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<CandleBarStats | null>(null);

  const activeCandleStats: CandleBarStats | null = hoveredCandle ?? (candles.length > 0 ? {
    open: candles[candles.length - 1].open,
    high: candles[candles.length - 1].high,
    low: candles[candles.length - 1].low,
    close: candles[candles.length - 1].close,
    volume: candles[candles.length - 1].volume,
  } : null);

  const handleToggleIndicator = (key: keyof VisibleIndicators) => {
    setVisibleIndicators(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveChartPreferences({ visibleIndicators: next });
      return next;
    });
  };

  const handleIntervalChange = useCallback((newInterval: ChartInterval) => {
    setInterval(newInterval);
    setCandles([]);
    setHoveredCandle(null);
    const prefs = loadChartPreferences();
    const savedPeriod = prefs.periodByInterval?.[newInterval] ?? null;
    setPeriod(savedPeriod);
    saveChartPreferences({ interval: newInterval });
  }, []);

  const handlePeriodChange = useCallback((newPeriod: ChartPeriod | null) => {
    setPeriod(newPeriod);
    saveChartPreferences({
      period: newPeriod,
      periodByInterval: {
        [interval]: newPeriod,
      },
    });
    setResetZoomTrigger(prev => prev + 1);
  }, [interval]);

  const handleZoomChange = useCallback((barSpacing: number, isUserManualZoom = true, rightOffset?: number) => {
    // When user manually zooms, scales, or pans the chart, deselect period button to reflect custom timeframe
    if (isUserManualZoom) {
      setPeriod(null);
    }
    saveChartPreferences({
      ...(isUserManualZoom ? { period: null, periodByInterval: { [interval]: null } } : {}),
      barSpacingByInterval: {
        [interval]: barSpacing,
      },
      ...(typeof rightOffset === 'number' ? {
        rightOffsetByInterval: {
          [interval]: rightOffset,
        },
      } : {}),
    });
  }, [interval]);

  // Lock body scroll and keyboard shortcuts
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'd' || e.key === 'D') {
        handleIntervalChange('day');
      } else if (e.key === 'w' || e.key === 'W') {
        handleIntervalChange('week');
      } else if (e.key === 'm' || e.key === 'M') {
        handleIntervalChange('month');
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, handleIntervalChange]);

  // Load trades and stock details once for this symbol
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getStockTrades(symbol).catch(() => []),
      getStockInfo(symbol).catch(() => null),
    ]).then(([tradesRes, infoRes]) => {
      if (isMounted) {
        setTrades(tradesRes);
        setStockInfo(infoRes);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [symbol]);

  // Fetch wide candles window when symbol or interval changes
  const fetchCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    hasMoreOlderRef.current = true;
    loadingOlderRef.current = false;
    try {
      const toDateObj = new Date();
      const toDate = toDateObj.toISOString().split('T')[0];
      let fromDate: string;

      if (interval === '5minute') {
        // Upstox max historical range for 5-minute is ~30 days
        const fromDateObj = new Date(toDateObj);
        fromDateObj.setDate(fromDateObj.getDate() - 30);
        fromDate = fromDateObj.toISOString().split('T')[0];
      } else {
        // Fetch wide 10-year window so all past periods render instantly and zooming out is smooth
        const fromDateObj = new Date(toDateObj);
        fromDateObj.setFullYear(fromDateObj.getFullYear() - 10);
        fromDate = fromDateObj.toISOString().split('T')[0];
      }

      const data = await getStockCandles(symbol, interval, fromDate, toDate);
      setCandles(data);
      if (data.length === 0) {
        setError('No historical candlestick data available for this symbol.');
        hasMoreOlderRef.current = false;
      } else if (interval === '5minute') {
        hasMoreOlderRef.current = false;
      } else {
        // If oldest candle is within 45 days of requested 10-year start date, older history may exist.
        const requestedFromTime = new Date(fromDate).getTime();
        const actualOldestTime = new Date(String(data[0].time).slice(0, 10)).getTime();
        const daysDiff = (actualOldestTime - requestedFromTime) / (1000 * 60 * 60 * 24);
        hasMoreOlderRef.current = daysDiff <= 45;
      }
    } catch {
      setError('Failed to load chart data.');
      hasMoreOlderRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  // Prepend older candles when user zooms out or scrolls near the earliest candle
  const handleLoadOlderCandles = useCallback(async () => {
    if (
      loadingOlderRef.current ||
      !hasMoreOlderRef.current ||
      interval === '5minute' ||
      candles.length === 0
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const oldestCandle = candles[0];
      const toDate = typeof oldestCandle.time === 'string'
        ? oldestCandle.time.slice(0, 10)
        : new Date(Number(oldestCandle.time) * 1000).toISOString().split('T')[0];

      const toDateObj = new Date(toDate);
      const fromDateObj = new Date(toDateObj);
      fromDateObj.setFullYear(fromDateObj.getFullYear() - 10);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      const older = await getStockCandles(symbol, interval, fromDate, toDate);
      // Avoid duplicates at the junction
      const filteredOlder = older.filter(c => String(c.time).slice(0, 10) < toDate);

      if (filteredOlder.length === 0) {
        hasMoreOlderRef.current = false;
      } else {
        const requestedFromTime = new Date(fromDate).getTime();
        const actualOldestTime = new Date(String(filteredOlder[0].time).slice(0, 10)).getTime();
        const daysDiff = (actualOldestTime - requestedFromTime) / (1000 * 60 * 60 * 24);
        hasMoreOlderRef.current = daysDiff <= 45;

        setCandles(prev => [...filteredOlder, ...prev]);
      }
    } catch (err) {
      console.error('Error fetching older candles:', err);
      hasMoreOlderRef.current = false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [symbol, interval, candles]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  // Price & change calculations
  const currentPrice = stockInfo?.currentPrice ?? holding?.currentPrice;
  const changePercent = stockInfo?.changePercent ?? holding?.dayChangePercent;
  const isPositive = (changePercent ?? 0) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3 md:p-4 pointer-events-none">
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm pointer-events-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <motion.div
        className="relative w-full h-full sm:w-[96vw] sm:h-[92vh] sm:max-w-[1536px] sm:max-h-[96vh] bg-slate-900 border-0 sm:border sm:border-white/10 rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden z-10 pointer-events-auto"
        initial={{ opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 12 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      >
        {/* Mobile Pull/Dismiss Handle */}
        <div className="sm:hidden flex justify-center items-center py-2 bg-slate-800/60 shrink-0 border-b border-white/5">
          <div className="w-10 h-1 rounded-full bg-white/25" />
        </div>

        {/* Header */}
        <div className="px-3 sm:px-6 py-2.5 sm:py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-2xl font-bold text-white tracking-wide">{symbol}</h2>
                {holding?.sector && (
                  <span className="text-[10px] sm:text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md truncate max-w-[140px] sm:max-w-[200px]">
                    {holding.sector}
                  </span>
                )}
                {holding?.marketCapCategory && (
                  <span className="text-[10px] sm:text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md">
                    {holding.marketCapCategory}
                  </span>
                )}
              </div>
              {currentPrice !== undefined && (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-base sm:text-lg font-bold text-gray-100 font-mono">
                    ₹{currentPrice.toFixed(2)}
                  </span>
                  {changePercent !== undefined && (
                    <span
                      className={`text-xs sm:text-sm font-bold tabular-nums ${
                        isPositive ? 'text-emerald-400' : 'text-rose-500'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {changePercent.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Controls: External links and Close */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a
              href={`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
              title="Open full page on TradingView.com"
            >
              <span>TradingView</span>
              <OpenInNewIcon sx={{ fontSize: 13 }} />
            </a>

            <a
              href={`https://www.screener.in/company/${symbol}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
              title="Screener.in"
            >
              <span>Screener</span>
              <OpenInNewIcon sx={{ fontSize: 13 }} />
            </a>

            <IconButton
              onClick={onClose}
              size="small"
              sx={{
                color: '#9ca3af',
                backgroundColor: 'rgba(255,255,255,0.05)',
                '&:hover': { color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.1)' },
              }}
              aria-label="Close chart"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>
        </div>

        {/* Modal Body: Chart Controls & Chart */}
        <div className="p-2 sm:p-4 md:p-5 flex-1 overflow-hidden flex flex-col gap-2 min-h-0">
          <div className="shrink-0">
            <ChartControls
              interval={interval}
              period={period}
              onIntervalChange={handleIntervalChange}
              onPeriodChange={handlePeriodChange}
              loading={loading || loadingOlder}
              isLogScale={isLogScale}
              onToggleLogScale={handleToggleLogScale}
              candleStats={activeCandleStats}
            />
          </div>

          {/* Chart Area - 100% fluidly stretches to fill remaining height */}
          <div className="flex-1 min-h-[280px] bg-slate-950/60 rounded-xl border border-white/5 p-1 relative flex flex-col overflow-hidden">
            {loading && candles.length === 0 ? (
              <div className="w-full h-full flex-1 flex flex-col items-center justify-center gap-3">
                <span className="relative flex h-5 w-5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-5 w-5 bg-blue-500"></span>
                </span>
                <span className="text-xs text-gray-400">Loading {symbol} candles...</span>
              </div>
            ) : error && candles.length === 0 ? (
              <div className="w-full h-full flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
                <p className="text-sm text-amber-400">{error}</p>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-2">
                  <a
                    href={`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1"
                  >
                    View on TradingView <OpenInNewIcon sx={{ fontSize: 13 }} />
                  </a>
                  <span>•</span>
                  <a
                    href={`https://www.screener.in/company/${symbol}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1"
                  >
                    View on Screener <OpenInNewIcon sx={{ fontSize: 13 }} />
                  </a>
                </div>
              </div>
            ) : (
              <TradingViewChart
                symbol={symbol}
                candles={candles}
                trades={trades}
                interval={interval}
                period={period}
                visibleIndicators={visibleIndicators}
                onIndicatorValues={setIndicatorValues}
                hoveredIndicator={hoveredIndicator}
                savedBarSpacing={loadChartPreferences().barSpacingByInterval?.[interval]}
                savedRightOffset={loadChartPreferences().rightOffsetByInterval?.[interval] ?? DEFAULT_RIGHT_OFFSET}
                isLogScale={isLogScale}
                onZoomChange={handleZoomChange}
                resetZoomTrigger={resetZoomTrigger}
                onNearStartOfData={handleLoadOlderCandles}
                onHoverCandle={setHoveredCandle}
              />
            )}
          </div>

          {/* Mobile Footer Links */}
          <div className="sm:hidden flex items-center justify-between px-1 pt-1 text-xs text-gray-400 shrink-0">
            <span className="text-[11px] text-gray-500">Press Esc to close</span>
            <div className="flex items-center gap-2">
              <a
                href={`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white"
              >
                TradingView
              </a>
              <span>|</span>
              <a
                href={`https://www.screener.in/company/${symbol}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white"
              >
                Screener
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function StockChartModal({
  symbol,
  isOpen,
  onClose,
  holding,
  privacyMode = false,
}: StockChartModalProps) {
  return (
    <AnimatePresence>
      {isOpen && symbol ? (
        <StockChartModalContent
          key={symbol}
          symbol={symbol}
          onClose={onClose}
          holding={holding}
          privacyMode={privacyMode}
        />
      ) : null}
    </AnimatePresence>
  );
}
