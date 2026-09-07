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
  MIN_BAR_SPACING,
  MAX_BAR_SPACING,
  getDefaultPeriodForInterval,
  loadChartPreferences,
  saveChartPreferences,
  sanitizeCandles,
} from '@/lib/chart-types';
import { getStockCandles, getStockTrades, getStockInfo } from '@/app/actions/chart';
import ChartControls from './ChartControls';
import { VisibleIndicators, IndicatorValues, LiveTick } from './TradingViewChart';
import { useLiveData } from '@/context/LiveDataContext';
import type { PriceUpdate } from '@/hooks/useUpstoxStream';
import { isMarketOpen } from '@/lib/market-status-utils';
import { todayISTYmd } from '@/lib/tz';

const TradingViewChart = dynamic(() => import('./TradingViewChart'), {
  loading: () => (
    <div className="h-full min-h-[380px] bg-slate-900/60 rounded-xl animate-pulse flex items-center justify-center text-gray-500 text-sm">
      Loading chart engine...
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
    const saved = initialPrefs.periodByInterval?.[initialPrefs.interval];
    if (saved !== undefined) return saved;
    if (initialPrefs.barSpacingByInterval?.[initialPrefs.interval]) return null;
    return initialPrefs.period ?? getDefaultPeriodForInterval(initialPrefs.interval);
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

  const { subscribeToPrices, subscribeToInstruments, initialize } = useLiveData();
  const [candles, setCandles] = useState<CandleData[]>([]);
  // Mirror candles in a ref so live-tick handler can read latest without stale closures
  const candlesRef = useRef<CandleData[]>([]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const [trades, setTrades] = useState<TradeMarker[]>([]);
  const [stockInfo, setStockInfo] = useState<{
    symbol: string;
    instrumentKey?: string;
    currentPrice?: number;
    change?: number;
    changePercent?: number;
    inPortfolio: boolean;
    quantity?: number;
    invested?: number;
    pnl?: number;
    pnlPercent?: number;
    todayOHLC?: { open: number; high: number; low: number; close: number; volume: number };
  } | null>(null);
  // Tracks the running live daily candle OHLC across ticks (so high/low accumulate correctly)
  const liveBarRef = useRef<LiveTick | null>(null);
  const [livePrice, setLivePrice] = useState<{
    price: number;
    change?: number;
    changePercent?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const hasMoreOlderRef = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [indicatorValues, setIndicatorValues] = useState<IndicatorValues>({});
  const [hoveredIndicator, setHoveredIndicator] = useState<keyof VisibleIndicators | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<CandleBarStats | null>(null);

  // Initialize live data connection
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Mirror stockInfo in a ref for use in buildLiveTick without stale closure
  const stockInfoRef = useRef(stockInfo);
  useEffect(() => { stockInfoRef.current = stockInfo; }, [stockInfo]);

  // Reset live price and liveBarRef when symbol changes
  useEffect(() => {
    setLivePrice(null);
    liveBarRef.current = null;
  }, [symbol]);

  // Register instrumentKey with Upstox live WebSocket
  useEffect(() => {
    if (!symbol) return;
    const upperSymbol = symbol.toUpperCase();
    if (stockInfo?.instrumentKey) {
      subscribeToInstruments([{ instrumentKey: stockInfo.instrumentKey, symbol: upperSymbol }]);
    }
  }, [symbol, stockInfo?.instrumentKey, subscribeToInstruments]);

  // Throttled application of live price updates to the active candlestick
  const latestLtpRef = useRef<number | null>(null);
  const candleUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef(interval);
  useEffect(() => { intervalRef.current = interval; }, [interval]);

  /**
   * Build a LiveTick from the latest known candle + current LTP.
   * This does NOT touch React state — it produces the small object
   * that TradingViewChart consumes via series.update().
   */
  const buildLiveTick = useCallback((ltp: number): LiveTick | null => {
    const prevCandles = candlesRef.current;
    if (!prevCandles || prevCandles.length === 0) return null;
    const last = prevCandles[prevCandles.length - 1];
    const now = new Date();
    const iv = intervalRef.current;

    if (iv === '5minute') {
      const IST_OFFSET_SECONDS = 19800;
      const nowSeconds = Math.floor(now.getTime() / 1000) + IST_OFFSET_SECONDS;
      const current5mBucket = Math.floor(nowSeconds / 300) * 300;
      const lastTimeNum = Number(last.time);

      if (current5mBucket > lastTimeNum) {
        // New 5m candle has opened
        const tick: LiveTick = { time: current5mBucket, open: ltp, high: ltp, low: ltp, close: ltp, volume: 0 };
        liveBarRef.current = tick;
        return tick;
      }
      // Update the current 5m candle — running high/low from last known candle
      const tick: LiveTick = {
        time: lastTimeNum,
        open: last.open,
        high: Math.max(last.high, ltp),
        low: Math.min(last.low, ltp),
        close: ltp,
        volume: last.volume,
      };
      liveBarRef.current = tick;
      return tick;
    }

    if (iv === 'day') {
      const todayYmd = todayISTYmd(now);
      const lastTimeStr = String(last.time).slice(0, 10);

      if (todayYmd > lastTimeStr) {
        // Today's candle not yet in historical data — need to synthesize it
        const todayOHLC = stockInfoRef.current?.todayOHLC;
        const prev = liveBarRef.current;

        let open: number;
        let high: number;
        let low: number;
        let volume: number;

        if (prev && String(prev.time).slice(0, 10) === todayYmd) {
          // Accumulate from existing live bar for today
          open = prev.open;
          high = Math.max(prev.high, ltp);
          low = Math.min(prev.low, ltp);
          volume = prev.volume;
        } else if (todayOHLC) {
          // Initialize from the real OHLC data fetched via /market-quote/ohlc
          open = todayOHLC.open;
          high = Math.max(todayOHLC.high, ltp);
          low = Math.min(todayOHLC.low, ltp);
          volume = todayOHLC.volume;
        } else {
          // No reference data — best effort: open=ltp (first tick of day)
          open = ltp;
          high = ltp;
          low = ltp;
          volume = 0;
        }

        const tick: LiveTick = { time: todayYmd, open, high, low, close: ltp, volume };
        liveBarRef.current = tick;
        return tick;
      }
    }

    // Daily (same-day bar present in history), week, or month:
    // Accumulate high/low from liveBarRef if it's for the same bar, else from last historical candle
    const prev = liveBarRef.current;
    const lastTimeKey = String(last.time).slice(0, 10);
    const prevTimeKey = prev ? String(prev.time).slice(0, 10) : null;

    const baseHigh = (prevTimeKey === lastTimeKey && prev) ? prev.high : last.high;
    const baseLow = (prevTimeKey === lastTimeKey && prev) ? prev.low : last.low;

    const tick: LiveTick = {
      time: last.time,
      open: last.open,
      high: Math.max(baseHigh, ltp),
      low: Math.min(baseLow, ltp),
      close: ltp,
      volume: last.volume,
    };
    liveBarRef.current = tick;
    return tick;
  }, []);

  const handleLivePriceUpdate = useCallback((ltp: number) => {
    latestLtpRef.current = ltp;
    // Throttle to ~200ms so we don't flood the chart on rapid ticks
    if (!candleUpdateTimerRef.current) {
      candleUpdateTimerRef.current = setTimeout(() => {
        candleUpdateTimerRef.current = null;
        const currentLtp = latestLtpRef.current;
        if (currentLtp !== null) {
          const tick = buildLiveTick(currentLtp);
          if (tick) setLiveTick(tick);
        }
      }, 200);
    }
  }, [buildLiveTick]);

  // Subscribe to WebSocket live price updates
  useEffect(() => {
    if (!symbol) return;
    const upperSymbol = symbol.toUpperCase();

    const unsubscribe = subscribeToPrices((updates: PriceUpdate[]) => {
      const match = updates.find(u => u.symbol.toUpperCase() === upperSymbol);
      if (match && match.ltp > 0) {
        setLivePrice({
          price: match.ltp,
          change: match.change,
          changePercent: match.changePercent,
        });
        handleLivePriceUpdate(match.ltp);
      }
    });

    return () => {
      unsubscribe();
      if (candleUpdateTimerRef.current) {
        clearTimeout(candleUpdateTimerRef.current);
        candleUpdateTimerRef.current = null;
      }
    };
  }, [symbol, subscribeToPrices, handleLivePriceUpdate]);

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
    setLiveTick(null);
    liveBarRef.current = null;
    setHoveredCandle(null);
    const prefs = loadChartPreferences();
    const savedPeriod = prefs.periodByInterval?.[newInterval];
    const hasManualZoom = Boolean(prefs.barSpacingByInterval?.[newInterval]);
    const nextPeriod = savedPeriod !== undefined
      ? savedPeriod
      : (hasManualZoom ? null : getDefaultPeriodForInterval(newInterval));
    setPeriod(nextPeriod);
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
    // Only user manual zooms/pans should deselect period and persist barSpacing
    if (!isUserManualZoom) return;

    setPeriod(null);
    saveChartPreferences({
      period: null,
      periodByInterval: { [interval]: null },
      barSpacingByInterval: {
        [interval]: Math.min(MAX_BAR_SPACING, Math.max(MIN_BAR_SPACING, barSpacing)),
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
      const cleanData = sanitizeCandles(data);
      setCandles(cleanData);
      if (cleanData.length === 0) {
        setError('No historical candlestick data available for this symbol.');
        hasMoreOlderRef.current = false;
      } else if (interval === '5minute') {
        hasMoreOlderRef.current = false;
      } else {
        // If oldest candle is within 45 days of requested 10-year start date, older history may exist.
        const requestedFromTime = new Date(fromDate).getTime();
        const actualOldestTime = new Date(String(cleanData[0].time).slice(0, 10)).getTime();
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

        setCandles(prev => sanitizeCandles([...filteredOlder, ...prev]));
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

  // Periodic background candle sync during market hours (every 20 seconds)
  const silentFetchCandles = useCallback(async () => {
    if (!symbol) return;
    try {
      const toDateObj = new Date();
      const toDate = toDateObj.toISOString().split('T')[0];
      let fromDate: string;

      if (interval === '5minute') {
        const fromDateObj = new Date(toDateObj);
        fromDateObj.setDate(fromDateObj.getDate() - 5);
        fromDate = fromDateObj.toISOString().split('T')[0];
      } else {
        const fromDateObj = new Date(toDateObj);
        fromDateObj.setDate(fromDateObj.getDate() - 30);
        fromDate = fromDateObj.toISOString().split('T')[0];
      }

      const [freshCandles, freshInfo] = await Promise.all([
        getStockCandles(symbol, interval, fromDate, toDate).catch(() => []),
        getStockInfo(symbol).catch(() => null),
      ]);

      if (freshInfo) {
        setStockInfo(freshInfo);
      }

      if (freshCandles.length > 0) {
        setCandles(prev => {
          if (!prev || prev.length === 0) return sanitizeCandles(freshCandles);
          return sanitizeCandles([...prev, ...freshCandles]);
        });
      }
    } catch {
      // Silent failure for background poll
    }
  }, [symbol, interval]);

  useEffect(() => {
    if (!symbol) return;
    const timer = window.setInterval(() => {
      if (isMarketOpen()) {
        silentFetchCandles();
      }
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [symbol, silentFetchCandles]);

  // Price & change calculations (live WebSocket price takes priority)
  const currentPrice = livePrice?.price ?? stockInfo?.currentPrice ?? holding?.currentPrice;
  const changePercent = livePrice?.changePercent ?? stockInfo?.changePercent ?? holding?.dayChangePercent;
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
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-wrap">
            <h2 className="text-lg sm:text-2xl font-bold text-white tracking-wide leading-none">{symbol}</h2>
            {currentPrice !== undefined && (
              <div className="flex items-baseline gap-1.5 sm:gap-2 leading-none">
                <span className="text-base sm:text-xl font-bold text-gray-100 font-mono">
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
            {holding?.marketCapCategory && (
              <span className="text-[10px] sm:text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md leading-none">
                {holding.marketCapCategory}
              </span>
            )}
            {holding?.sector && (
              <span className="text-[10px] sm:text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md truncate max-w-[120px] sm:max-w-[200px] leading-none">
                {holding.sector}
              </span>
            )}
            {isMarketOpen() && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold leading-none">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span>LIVE</span>
              </div>
            )}
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
                liveTick={liveTick}
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
