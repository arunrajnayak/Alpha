'use client';

import { memo, useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faArrowTrendUp,
  faArrowTrendDown,
  faArrowUp,
  faArrowDown,
  faMagnifyingGlass,
  faArrowsRotate,
  faSort,
  faSortUp,
  faSortDown,
  faFire,
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';
import { LiveStockData } from '@/app/actions/live';
import IntradaySparkline from './IntradaySparkline';
import AnimatedNumber from './AnimatedNumber';
import type { Variants } from 'framer-motion';

interface LiveStockDynamicsTableProps {
  holdings: LiveStockData[];
  onRefresh?: () => Promise<void>;
  privacyMode?: boolean;
  isMobile?: boolean;
  downloading?: boolean;
  itemVariants?: Variants;
}

type SortColumn =
  | 'symbol'
  | 'currentPrice'
  | 'dayChangePercent'
  | 'recoveryFromLowPct'
  | 'fallFromHighPct'
  | 'changeFromOpenPct'
  | 'dist52wHighPct'
  | 'distAthPct'
  | 'rvol'
  | 'todayVolume';

type SortDirection = 'asc' | 'desc';

type FilterTab = 'all' | 'gainers_open' | 'near_high' | 'near_52w' | 'heavy_vol';

function formatVolume(vol: number | undefined): string {
  if (!vol || vol === 0) return '0';
  if (vol >= 10_000_000) return `${(vol / 10_000_000).toFixed(2)} Cr`;
  if (vol >= 100_000) return `${(vol / 100_000).toFixed(2)} L`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)} K`;
  return vol.toLocaleString('en-IN');
}

function getMarketCapBadge(cat?: string) {
  const c = (cat || '').toLowerCase();
  if (c.includes('large')) {
    return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded">Large</span>;
  }
  if (c.includes('mid')) {
    return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded">Mid</span>;
  }
  if (c.includes('small')) {
    return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">Small</span>;
  }
  if (c.includes('micro')) {
    return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-700/50 text-gray-400 border border-slate-600/30 rounded">Micro</span>;
  }
  return null;
}

const LiveStockDynamicsTable = memo(function LiveStockDynamicsTable({
  holdings,
  onRefresh,
  privacyMode = false,
  isMobile = false,
  downloading = false,
  itemVariants,
}: LiveStockDynamicsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [sortCol, setSortCol] = useState<SortColumn>('dayChangePercent');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [countdown, setCountdown] = useState(10);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Intraday Sparklines cache { [symbol]: pricePoints[] }
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});

  // 10s Countdown Timer logic
  useEffect(() => {
    if (downloading) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Trigger subtle 10s visual sync pulse
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [downloading]);

  // Reset countdown whenever new holdings data arrives
  useEffect(() => {
    setCountdown(10);
  }, [holdings]);

  // Fetch intraday sparkline candles
  useEffect(() => {
    let isMounted = true;
    async function loadSparklines() {
      try {
        const res = await fetch('/api/live/sparklines');
        if (!res.ok) return;
        const json = await res.json();
        if (json?.sparklines && isMounted) {
          setSparklines(json.sparklines);
        }
      } catch (err) {
        // Silent fallback
      }
    }

    loadSparklines();
    // Re-fetch sparklines every 2 minutes
    const timer = setInterval(loadSparklines, 120_000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  // Update sparklines in-memory with latest price tick
  useEffect(() => {
    if (holdings.length === 0) return;
    setSparklines((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const h of holdings) {
        if (!h.currentPrice) continue;
        const pts = next[h.symbol] || (h.dayOpen ? [h.dayOpen, h.dayLow || h.currentPrice, h.dayHigh || h.currentPrice] : []);
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          if (Math.abs(last - h.currentPrice) > 0.01) {
            next[h.symbol] = [...pts.slice(-24), h.currentPrice];
            changed = true;
          }
        } else {
          next[h.symbol] = [h.dayOpen || h.previousClose || h.currentPrice, h.currentPrice];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [holdings]);

  const handleManualRefresh = useCallback(async () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
        setCountdown(10);
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [onRefresh, isRefreshing]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  // Filter & Sort
  const filteredHoldings = useMemo(() => {
    const list = holdings.filter((h) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const symMatch = h.symbol.toLowerCase().includes(q);
        const secMatch = (h.sector || '').toLowerCase().includes(q);
        if (!symMatch && !secMatch) return false;
      }

      switch (activeTab) {
        case 'gainers_open':
          return (h.changeFromOpenPct || 0) > 0;
        case 'near_high':
          return (h.fallFromHighPct || 0) >= -1.5;
        case 'near_52w':
          return (h.dist52wHighPct || 0) >= -5;
        case 'heavy_vol':
          return (h.rvol || 0) >= 1.0;
        default:
          return true;
      }
    });

    list.sort((a, b) => {
      let valA: any = a[sortCol];
      let valB: any = b[sortCol];

      if (valA === undefined || valA === null) valA = sortDir === 'asc' ? Infinity : -Infinity;
      if (valB === undefined || valB === null) valB = sortDir === 'asc' ? Infinity : -Infinity;

      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [holdings, searchQuery, activeTab, sortCol, sortDir]);

  const counts = useMemo(() => ({
    all: holdings.length,
    gainers_open: holdings.filter((h) => (h.changeFromOpenPct || 0) > 0).length,
    near_high: holdings.filter((h) => (h.fallFromHighPct || 0) >= -1.5).length,
    near_52w: holdings.filter((h) => (h.dist52wHighPct || 0) >= -5).length,
    heavy_vol: holdings.filter((h) => (h.rvol || 0) >= 1.0).length,
  }), [holdings]);

  const renderSortIcon = (col: SortColumn) => {
    if (sortCol !== col) {
      return <FontAwesomeIcon icon={faSort} className="text-gray-600 text-[10px] ml-1 opacity-40 hover:opacity-100" />;
    }
    return (
      <FontAwesomeIcon
        icon={sortDir === 'asc' ? faSortUp : faSortDown}
        className="text-emerald-400 text-[11px] ml-1"
      />
    );
  };

  return (
    <motion.div
      variants={itemVariants}
      data-motion-section
      className="bg-slate-900/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col"
    >
      {/* Card Header */}
      <div className="px-4 py-4 md:px-6 md:py-5 border-b border-white/10 bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FontAwesomeIcon icon={faBolt} className="text-sm" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base md:text-lg font-bold text-white">Intraday Dynamics & Technical Pulse</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10">
                  {holdings.length} stocks
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Real-time 10s price recovery, range, momentum, volume & ATH distance
              </p>
            </div>
          </div>
        </div>

        {/* 10s Live Pulse & Controls */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          {/* Live Sync Badge with Countdown */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-white/10 text-xs text-gray-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-medium">Live 10s</span>
            <span className="text-gray-500">|</span>
            <span className="tabular-nums text-emerald-400 font-mono font-semibold">{countdown}s</span>
          </div>

          {onRefresh && (
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              title="Refresh now"
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl border border-white/10 text-gray-300 hover:text-white transition-colors text-xs flex items-center gap-1.5"
            >
              <FontAwesomeIcon icon={faArrowsRotate} className={`text-xs ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="px-4 py-3 md:px-6 border-b border-white/5 bg-slate-950/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Quick Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === 'all'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800/60 text-gray-400 hover:text-gray-200 border border-white/5'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            onClick={() => setActiveTab('gainers_open')}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === 'gainers_open'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800/60 text-gray-400 hover:text-gray-200 border border-white/5'
            }`}
          >
            Up from Open ({counts.gainers_open})
          </button>
          <button
            onClick={() => setActiveTab('near_high')}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === 'near_high'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800/60 text-gray-400 hover:text-gray-200 border border-white/5'
            }`}
          >
            Near Day High ({counts.near_high})
          </button>
          <button
            onClick={() => setActiveTab('near_52w')}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === 'near_52w'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : 'bg-slate-800/60 text-gray-400 hover:text-gray-200 border border-white/5'
            }`}
          >
            Near 52W High ({counts.near_52w})
          </button>
          <button
            onClick={() => setActiveTab('heavy_vol')}
            className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === 'heavy_vol'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'bg-slate-800/60 text-gray-400 hover:text-gray-200 border border-white/5'
            }`}
          >
            Heavy Vol ({counts.heavy_vol})
          </button>
        </div>

        {/* Search input */}
        <div className="relative min-w-[180px] max-w-xs">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
          <input
            type="text"
            placeholder="Search stock..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-8 pr-3 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto relative scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        <table className="w-full text-left border-collapse min-w-[980px]">
          <thead>
            <tr className="border-b border-white/10 bg-slate-950/70 text-[11px] font-semibold text-gray-400 select-none">
              {/* Sticky Stock Column */}
              <th
                onClick={() => handleSort('symbol')}
                className="py-3 px-4 sticky left-0 z-20 bg-slate-950/95 backdrop-blur-md cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 160 }}
              >
                <div className="flex items-center">
                  <span>Stock</span>
                  {renderSortIcon('symbol')}
                </div>
              </th>

              {/* Price & Day Change */}
              <th
                onClick={() => handleSort('currentPrice')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 130 }}
              >
                <div className="flex items-center justify-end">
                  <span>LTP / Change</span>
                  {renderSortIcon('currentPrice')}
                </div>
              </th>

              {/* Day Sparkline & Range */}
              <th className="py-3 px-3 text-center" style={{ minWidth: 140 }}>
                <span>Today&apos;s Trend &amp; Range</span>
              </th>

              {/* Recovery from Day Low */}
              <th
                onClick={() => handleSort('recoveryFromLowPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 115 }}
                title="Percentage recovered from today's lowest price"
              >
                <div className="flex items-center justify-end">
                  <span>From Day Low</span>
                  {renderSortIcon('recoveryFromLowPct')}
                </div>
              </th>

              {/* Fall from Day High */}
              <th
                onClick={() => handleSort('fallFromHighPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 115 }}
                title="Percentage dropped from today's highest price"
              >
                <div className="flex items-center justify-end">
                  <span>From Day High</span>
                  {renderSortIcon('fallFromHighPct')}
                </div>
              </th>

              {/* Gain/Loss from Open */}
              <th
                onClick={() => handleSort('changeFromOpenPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 115 }}
                title="Net percentage move after the opening tick"
              >
                <div className="flex items-center justify-end">
                  <span>From Open</span>
                  {renderSortIcon('changeFromOpenPct')}
                </div>
              </th>

              {/* Distance from 52W High */}
              <th
                onClick={() => handleSort('dist52wHighPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 115 }}
                title="Percentage distance from 52-week high"
              >
                <div className="flex items-center justify-end">
                  <span>From 52W High</span>
                  {renderSortIcon('dist52wHighPct')}
                </div>
              </th>

              {/* Distance from ATH */}
              <th
                onClick={() => handleSort('distAthPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 110 }}
                title="Percentage distance from all-time high"
              >
                <div className="flex items-center justify-end">
                  <span>From ATH</span>
                  {renderSortIcon('distAthPct')}
                </div>
              </th>

              {/* Volume & 1M Avg (RVol) */}
              <th
                onClick={() => handleSort('todayVolume')}
                className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 140 }}
                title="Today's cumulative volume compared to 1-month average daily volume"
              >
                <div className="flex items-center justify-end">
                  <span>Vol / 1M Avg</span>
                  {renderSortIcon('todayVolume')}
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/5 text-xs">
            {filteredHoldings.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-500">
                  No stocks match the current filter or search criteria.
                </td>
              </tr>
            ) : (
              filteredHoldings.map((stock) => {
                const price = stock.currentPrice || 0;
                const prevClose = stock.previousClose || price;
                const isDayPositive = stock.dayChangePercent >= 0;

                // Recovery from Day Low
                const recLow = stock.recoveryFromLowPct ?? 0;
                // Fall from Day High
                const dropHigh = stock.fallFromHighPct ?? 0;
                // Gain from Open
                const gainOpen = stock.changeFromOpenPct ?? 0;
                // 52W High
                const dist52w = stock.dist52wHighPct ?? 0;
                // ATH
                const distAth = stock.distAthPct ?? 0;
                // Volume & RVol
                const rvol = stock.rvol ?? 0;

                // Day Range Bar metrics
                const low = stock.dayLow || price;
                const high = stock.dayHigh || price;
                const open = stock.dayOpen || prevClose;
                const rangeSpan = high - low || (price * 0.01) || 1;
                const currentPosPct = Math.max(0, Math.min(100, ((price - low) / rangeSpan) * 100));
                const openPosPct = Math.max(0, Math.min(100, ((open - low) / rangeSpan) * 100));

                const sparkPoints = sparklines[stock.symbol] || (open ? [open, low, high, price] : [price, price]);

                return (
                  <tr
                    key={stock.symbol}
                    data-motion-item
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Sticky Stock Column */}
                    <td className="py-3 px-4 sticky left-0 z-10 bg-slate-900/95 group-hover:bg-slate-900/95 backdrop-blur-md border-r border-white/5 md:border-r-0">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white text-sm tracking-tight">{stock.symbol}</span>
                          {getMarketCapBadge(stock.marketCapCategory)}
                        </div>
                        <span className="text-[11px] text-gray-400 truncate max-w-[130px]">
                          {stock.sector || 'Equities'}
                        </span>
                      </div>
                    </td>

                    {/* LTP & Day Change */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <AnimatedNumber
                          value={price}
                          format={(v) => formatCurrency(v, 2, 2)}
                          downloading={downloading}
                          className="font-bold text-sm text-white"
                        />
                        <div
                          className={`flex items-center gap-1 text-[11px] font-semibold ${
                            isDayPositive ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          <FontAwesomeIcon icon={isDayPositive ? faArrowTrendUp : faArrowTrendDown} className="text-[10px]" />
                          <span className="tabular-nums">
                            {isDayPositive ? '+' : ''}{stock.dayChangePercent.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Today's Trend & Range */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col items-center gap-1.5 w-full max-w-[120px] mx-auto">
                        {/* Intraday Sparkline */}
                        <IntradaySparkline
                          data={sparkPoints}
                          width={92}
                          height={24}
                          trendPositive={price >= open}
                          uniqueId={`spark-${stock.symbol}`}
                        />

                        {/* Mini Range Bar (Low ──●── High) */}
                        <div className="w-full flex flex-col gap-0.5" title={`L: ₹${low.toFixed(1)} | H: ₹${high.toFixed(1)} | Open: ₹${open.toFixed(1)}`}>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full relative overflow-hidden border border-white/5">
                            {/* Open marker */}
                            <div
                              className="absolute top-0 bottom-0 w-0.5 bg-gray-500/80 z-0"
                              style={{ left: `${openPosPct}%` }}
                            />
                            {/* Current price marker */}
                            <div
                              className={`absolute top-0 bottom-0 w-2 h-2 -translate-y-[1px] -translate-x-1 rounded-full shadow z-10 ${
                                price >= open ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                              style={{ left: `${currentPosPct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] text-gray-500 font-mono px-0.5">
                            <span>₹{low >= 1000 ? low.toFixed(0) : low.toFixed(1)}</span>
                            <span>₹{high >= 1000 ? high.toFixed(0) : high.toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Recovery from Day Low */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono font-semibold text-[11px] tabular-nums ${
                            recLow > 0.1
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800/60 text-gray-400 border border-white/5'
                          }`}
                        >
                          {recLow > 0.1 && <FontAwesomeIcon icon={faArrowUp} className="text-[9px]" />}
                          +{recLow.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Fall from Day High */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        {Math.abs(dropHigh) <= 0.05 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold text-[10px]">
                            At High
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono font-semibold text-[11px] tabular-nums ${
                              dropHigh <= -2.0
                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                : 'bg-slate-800/60 text-rose-300/80 border border-white/5'
                            }`}
                          >
                            <FontAwesomeIcon icon={faArrowDown} className="text-[9px]" />
                            {dropHigh.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Gain/Loss from Open */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono font-semibold text-[11px] tabular-nums ${
                            gainOpen > 0
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : gainOpen < 0
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-slate-800/60 text-gray-400 border border-white/5'
                          }`}
                        >
                          {gainOpen > 0 ? '+' : ''}{gainOpen.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Distance from 52W High */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        {dist52w >= -0.1 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-300 border border-amber-500/30 font-bold text-[10px]">
                            52W High!
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-lg font-mono font-semibold text-[11px] tabular-nums ${
                              dist52w >= -3.0
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-slate-800/60 text-purple-300/80 border border-white/5'
                            }`}
                            title={`52W High: ₹${stock.high52w?.toFixed(1) || '—'}`}
                          >
                            {dist52w.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Distance from ATH */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        {distAth >= -0.1 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gradient-to-r from-yellow-500/25 to-amber-600/25 text-yellow-300 border border-yellow-500/40 font-black text-[10px]">
                            ATH
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-800/60 text-indigo-300/90 border border-white/5 font-mono font-semibold text-[11px] tabular-nums"
                            title={`ATH: ₹${stock.ath?.toFixed(1) || '—'}`}
                          >
                            {distAth.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Volume vs 1M Avg (RVol) */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-white text-xs font-semibold">
                            {formatVolume(stock.todayVolume)}
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            / {formatVolume(stock.avgVolume1m)}
                          </span>
                        </div>

                        {/* RVol badge */}
                        <div className="flex items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                              rvol >= 2.0
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                : rvol >= 1.0
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-gray-400 border border-white/5'
                            }`}
                          >
                            {rvol >= 2.0 && <FontAwesomeIcon icon={faFire} className="text-[9px] text-amber-400" />}
                            {rvol > 0 ? `${rvol.toFixed(2)}x` : '—'}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
});

export default LiveStockDynamicsTable;
