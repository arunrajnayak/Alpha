'use client';

import { memo, useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faArrowTrendUp,
  faArrowTrendDown,
  faArrowUp,
  faArrowDown,
  faSort,
  faSortUp,
  faSortDown,
  faFire,
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';
import { LiveStockData, MarketStatus } from '@/app/actions/live';
import IntradaySparkline from './IntradaySparkline';
import AnimatedNumber from './AnimatedNumber';
import type { Variants } from 'framer-motion';

interface LiveStockDynamicsTableProps {
  holdings: LiveStockData[];
  lastRefreshed?: Date | null;
  marketStatus?: MarketStatus;
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
  | 'distAthPct'
  | 'rvol';

type SortDirection = 'asc' | 'desc';

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
  lastRefreshed,
  marketStatus = 'CLOSED',
  privacyMode = false,
  isMobile = false,
  downloading = false,
  itemVariants,
}: LiveStockDynamicsTableProps) {
  const [sortCol, setSortCol] = useState<SortColumn>('dayChangePercent');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [timeAgoStr, setTimeAgoStr] = useState('just now');

  // Intraday Sparklines cache { [symbol]: pricePoints[] }
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});

  const isMarketOpen = marketStatus === 'OPEN' || marketStatus === 'PRE_OPEN';

  // Dynamic "Refreshed Xs ago" counter
  useEffect(() => {
    const updateTime = () => {
      if (!lastRefreshed) {
        setTimeAgoStr('just now');
        return;
      }
      const diffSec = Math.max(0, Math.floor((Date.now() - new Date(lastRefreshed).getTime()) / 1000));
      if (diffSec < 5) {
        setTimeAgoStr('just now');
      } else if (diffSec < 60) {
        setTimeAgoStr(`${diffSec}s ago`);
      } else {
        const mins = Math.floor(diffSec / 60);
        setTimeAgoStr(`${mins}m ago`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [lastRefreshed]);

  // Fetch intraday sparklines
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
    // Only periodically poll sparklines during market hours
    if (isMarketOpen) {
      const timer = setInterval(loadSparklines, 120_000);
      return () => {
        isMounted = false;
        clearInterval(timer);
      };
    }
    return () => {
      isMounted = false;
    };
  }, [isMarketOpen]);

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

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  // Sort holdings
  const sortedHoldings = useMemo(() => {
    const list = [...holdings];

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
  }, [holdings, sortCol, sortDir]);

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
      <div className="px-4 py-4 md:px-6 md:py-5 border-b border-white/10 bg-slate-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <FontAwesomeIcon icon={faBolt} className="text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-base md:text-lg font-bold text-white">Intraday Dynamics &amp; Technical Pulse</h3>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10">
              {holdings.length} stocks
            </span>
          </div>
        </div>

        {/* Status Chip / Time Ago */}
        <div className="flex items-center gap-2.5">
          {!isMarketOpen ? (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800/90 text-gray-400 border border-white/10">
              Market Closed
            </span>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/70 border border-white/10 text-xs text-gray-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-gray-400">Refreshed</span>
              <span className="font-mono text-emerald-400 font-medium">{timeAgoStr}</span>
            </div>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto relative scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        <table className="w-full text-left border-collapse min-w-[960px]">
          <thead>
            <tr className="border-b border-white/10 bg-slate-950/70 text-[11px] font-semibold text-gray-400 select-none">
              {/* Sticky Stock Column */}
              <th
                onClick={() => handleSort('symbol')}
                className="py-3 px-4 sticky left-0 z-20 bg-slate-950/95 backdrop-blur-md cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 140 }}
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
                style={{ minWidth: 125 }}
              >
                <div className="flex items-center justify-end">
                  <span>LTP / Change</span>
                  {renderSortIcon('currentPrice')}
                </div>
              </th>

              {/* Day Sparkline */}
              <th className="py-3 px-3 text-center" style={{ minWidth: 110 }}>
                <span>Day Sparkline</span>
              </th>

              {/* Day Range (Filled Bar) */}
              <th className="py-3 px-3 text-center" style={{ minWidth: 150 }}>
                <span>Day Range</span>
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
                style={{ minWidth: 110 }}
                title="Net percentage move after opening tick"
              >
                <div className="flex items-center justify-end">
                  <span>From Open</span>
                  {renderSortIcon('changeFromOpenPct')}
                </div>
              </th>

              {/* Distance from ATH */}
              <th
                onClick={() => handleSort('distAthPct')}
                className="py-3 px-3 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 105 }}
                title="Percentage distance from all-time high"
              >
                <div className="flex items-center justify-end">
                  <span>From ATH</span>
                  {renderSortIcon('distAthPct')}
                </div>
              </th>

              {/* Volume / 30D Avg (zX) */}
              <th
                onClick={() => handleSort('rvol')}
                className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                style={{ minWidth: 135 }}
                title="Volume multiplier z relative to last 30d average volume X"
              >
                <div className="flex items-center justify-end">
                  <span>Vol / 30D Avg</span>
                  {renderSortIcon('rvol')}
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/5 text-xs">
            {sortedHoldings.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-500">
                  No portfolio holdings available.
                </td>
              </tr>
            ) : (
              sortedHoldings.map((stock) => {
                const price = stock.currentPrice || 0;
                const prevClose = stock.previousClose || price;
                const isDayPositive = stock.dayChangePercent >= 0;

                // Technical percentage metrics
                const recLow = stock.recoveryFromLowPct ?? 0;
                const dropHigh = stock.fallFromHighPct ?? 0;
                const gainOpen = stock.changeFromOpenPct ?? 0;
                const distAth = stock.distAthPct ?? 0;
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
                    {/* Sticky Stock Column (Symbol + Market Cap badge only) */}
                    <td className="py-3 px-4 sticky left-0 z-10 bg-slate-900/95 group-hover:bg-slate-900/95 backdrop-blur-md border-r border-white/5 md:border-r-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-sm tracking-tight">{stock.symbol}</span>
                        {getMarketCapBadge(stock.marketCapCategory)}
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

                    {/* Day Sparkline Column */}
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-center w-full max-w-[100px] mx-auto">
                        <IntradaySparkline
                          data={sparkPoints}
                          width={88}
                          height={24}
                          trendPositive={price >= open}
                          uniqueId={`spark-${stock.symbol}`}
                        />
                      </div>
                    </td>

                    {/* Day Range (Filled Bar) */}
                    <td className="py-3 px-3">
                      <div
                        className="flex flex-col gap-1 w-full max-w-[140px] mx-auto"
                        title={`Low: ₹${low.toFixed(1)} | High: ₹${high.toFixed(1)} | Open: ₹${open.toFixed(1)}`}
                      >
                        {/* Filled Bar Container */}
                        <div className="w-full h-2 bg-slate-800/90 rounded-full relative overflow-hidden border border-white/5">
                          {/* Filled bar from Low up to current LTP */}
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isDayPositive
                                ? 'bg-gradient-to-r from-emerald-600/70 to-emerald-400'
                                : 'bg-gradient-to-r from-rose-600/70 to-rose-400'
                            }`}
                            style={{ width: `${Math.max(4, Math.min(100, currentPosPct))}%` }}
                          />
                          {/* Open tick marker */}
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-white/70 z-10"
                            style={{ left: `${openPosPct}%` }}
                          />
                        </div>

                        {/* Labels: Low on left, High on right */}
                        <div className="flex justify-between text-[10px] text-gray-400 font-mono px-0.5">
                          <span>₹{low >= 1000 ? low.toFixed(0) : low.toFixed(1)}</span>
                          <span>₹{high >= 1000 ? high.toFixed(0) : high.toFixed(1)}</span>
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

                    {/* Volume / 30D Avg: Format as zX (e.g. 1.2x (57.4 K)) */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span
                          className={`font-mono font-bold text-xs ${
                            rvol >= 2.0
                              ? 'text-cyan-400'
                              : rvol >= 1.0
                              ? 'text-emerald-400'
                              : 'text-gray-300'
                          }`}
                        >
                          {rvol > 0 ? `${rvol.toFixed(1)}x` : '—'}
                          {rvol >= 2.0 && <FontAwesomeIcon icon={faFire} className="text-[10px] text-amber-400 ml-1" />}
                        </span>
                        <span className="text-gray-400 font-mono text-[11px]">
                          ({formatVolume(stock.avgVolume1m)})
                        </span>
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
