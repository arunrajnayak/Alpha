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
  faCircleInfo,
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';
import { LiveStockData, MarketStatus } from '@/app/actions/live';
import IntradaySparkline from './IntradaySparkline';
import AnimatedNumber from './AnimatedNumber';
import type { Variants } from 'framer-motion';

interface LiveStockDynamicsTableProps {
  id?: string;
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

function getRecoveryChip(recLow: number) {
  if (recLow < 0.1) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-800/80 text-gray-400 border border-white/10 font-semibold text-[10px]">
        At Low
      </span>
    );
  }

  let chipStyle = '';
  if (recLow >= 6.0) {
    // Exceptional reversal / surge (>= 6%)
    chipStyle = 'bg-gradient-to-r from-emerald-500/30 to-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold shadow-sm shadow-cyan-500/20';
  } else if (recLow >= 3.5) {
    // Strong recovery (3.5% - 6%)
    chipStyle = 'bg-teal-500/25 text-teal-200 border border-teal-400/40 font-bold';
  } else if (recLow >= 1.5) {
    // Solid recovery (1.5% - 3.5%)
    chipStyle = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-semibold';
  } else {
    // Mild recovery (< 1.5%)
    chipStyle = 'bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 font-medium';
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-[11px] tabular-nums ${chipStyle}`}>
      <FontAwesomeIcon icon={faArrowUp} className="text-[9px]" />
      +{recLow.toFixed(2)}%
    </span>
  );
}

function getFallFromHighChip(dropHigh: number) {
  if (Math.abs(dropHigh) <= 0.08) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-semibold text-[10px]">
        At High
      </span>
    );
  }

  let chipStyle = '';
  if (dropHigh <= -4.5) {
    // Severe drop from peak (<= -4.5%)
    chipStyle = 'bg-rose-500/25 text-rose-200 border border-rose-500/50 font-bold shadow-sm shadow-rose-500/20';
  } else if (dropHigh <= -2.5) {
    // Noticeable drop (-2.5% to -4.5%)
    chipStyle = 'bg-orange-500/20 text-orange-200 border border-orange-500/35 font-semibold';
  } else if (dropHigh <= -1.0) {
    // Moderate pullback (-1.0% to -2.5%)
    chipStyle = 'bg-amber-500/15 text-amber-200 border border-amber-500/30 font-medium';
  } else {
    // Minor pullback (>-1.0%) - holding near high
    chipStyle = 'bg-emerald-500/15 text-emerald-300/90 border border-emerald-500/25 font-medium';
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-[11px] tabular-nums ${chipStyle}`}>
      <FontAwesomeIcon icon={faArrowDown} className="text-[9px]" />
      {dropHigh.toFixed(2)}%
    </span>
  );
}

function getAthDistanceChip(distAth: number, ath?: number) {
  if (distAth >= -0.1) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gradient-to-r from-yellow-500/25 to-amber-600/25 text-yellow-300 border border-yellow-500/40 font-black text-[10px]">
        ATH
      </span>
    );
  }

  let chipStyle = '';
  if (distAth >= -3.0) {
    // Very close to ATH (< 3% away): vibrant glowing emerald
    chipStyle = 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40 font-bold shadow-sm shadow-emerald-500/20';
  } else if (distAth >= -6.0) {
    // Close to ATH (< 6% away): crisp emerald
    chipStyle = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold';
  } else if (distAth >= -10.0) {
    // Moderately close to ATH (< 10% away): mild emerald
    chipStyle = 'bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 font-medium';
  } else if (distAth >= -20.0) {
    // Normal consolidation / pullback (10% to 20% away): neutral slate
    chipStyle = 'bg-slate-800/60 text-slate-400 border border-white/5 font-medium';
  } else {
    // Deep correction (> 20% away from ATH): rose red
    chipStyle = 'bg-rose-500/15 text-rose-400 border border-rose-500/25 font-medium';
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-lg font-mono text-[11px] tabular-nums ${chipStyle}`}
      title={`ATH: ₹${ath?.toFixed(1) || '—'}`}
    >
      {distAth.toFixed(1)}%
    </span>
  );
}

const LiveStockDynamicsTable = memo(function LiveStockDynamicsTable({
  id = 'intraday-dynamics',
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
  const symbolsList = useMemo(() => {
    return holdings.map(h => h.symbol).filter(Boolean).sort().join(',');
  }, [holdings]);

  useEffect(() => {
    let isMounted = true;
    async function loadSparklines() {
      try {
        const url = symbolsList
          ? `/api/live/sparklines?symbols=${encodeURIComponent(symbolsList)}`
          : '/api/live/sparklines';
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (json?.sparklines && isMounted) {
          setSparklines(prev => ({ ...prev, ...json.sparklines }));
        }
      } catch (err) {
        // Silent fallback
      }
    }

    if (holdings.length > 0) {
      loadSparklines();
    }

    // Only periodically poll sparklines during market hours
    if (isMarketOpen && holdings.length > 0) {
      const timer = setInterval(loadSparklines, 120_000);
      return () => {
        isMounted = false;
        clearInterval(timer);
      };
    }
    return () => {
      isMounted = false;
    };
  }, [isMarketOpen, symbolsList, holdings.length]);

  // Update sparklines in-memory with latest price tick
  useEffect(() => {
    if (holdings.length === 0) return;
    setSparklines((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const h of holdings) {
        if (!h.currentPrice) continue;
        const pts = next[h.symbol];
        if (pts && pts.length > 0) {
          const last = pts[pts.length - 1];
          if (Math.abs(last - h.currentPrice) > 0.01) {
            next[h.symbol] = [...pts.slice(-24), h.currentPrice];
            changed = true;
          }
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
      id={id}
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
            <h3 className="text-base md:text-lg font-bold text-white">Intraday Dynamics</h3>
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
        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b border-white/10 bg-slate-950/70 text-[11px] font-semibold text-gray-400 select-none">
              {/* Sticky Stock Column */}
              <th
                onClick={() => handleSort('symbol')}
                className="py-3 px-4 sticky left-0 z-30 bg-slate-950 cursor-pointer hover:text-white transition-colors border-r border-white/10 shadow-[2px_0_8px_rgba(0,0,0,0.4)]"
                style={{ minWidth: 115 }}
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

              {/* Volume */}
              <th
                onClick={() => handleSort('rvol')}
                className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors group/vol"
                style={{ minWidth: 110 }}
                title={"Volume: Today's volume relative to 30-day average volume (multiplier).\n\n• ≥ 2.0x : High volume surge (🔥)\n• ≥ 1.0x : Above average volume\n• < 0.5x : Low volume / dry day"}
              >
                <div
                  className="flex items-center justify-end gap-1.5"
                  title={"Volume: Today's volume relative to 30-day average volume (multiplier).\n\n• ≥ 2.0x : High volume surge (🔥)\n• ≥ 1.0x : Above average volume\n• < 0.5x : Low volume / dry day"}
                >
                  <span title={"Volume: Today's volume relative to 30-day average volume (multiplier).\n\n• ≥ 2.0x : High volume surge (🔥)\n• ≥ 1.0x : Above average volume\n• < 0.5x : Low volume / dry day"}>
                    Volume
                  </span>
                  <FontAwesomeIcon
                    icon={faCircleInfo}
                    className="text-[10px] text-gray-500 group-hover/vol:text-gray-300 transition-colors"
                  />
                  {renderSortIcon('rvol')}
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/5 text-xs">
            {sortedHoldings.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500">
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
                const distAth = stock.distAthPct ?? 0;
                const rvol = stock.rvol ?? 0;

                // Day Range Bar metrics (guarantee low <= price <= high)
                const low = Math.min(stock.dayLow || price, price);
                const high = Math.max(stock.dayHigh || price, price);
                const open = stock.dayOpen || prevClose;
                const rangeSpan = Math.max(0.01, high - low);
                const currentPosPct = Math.max(0, Math.min(100, ((price - low) / rangeSpan) * 100));
                const sparkPoints = sparklines[stock.symbol];

                return (
                  <tr
                    key={stock.symbol}
                    data-motion-item
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Sticky Stock Column (Symbol only) */}
                    <td className="py-3 px-4 sticky left-0 z-20 bg-slate-900 group-hover:bg-[#151f32] transition-colors border-r border-white/10 shadow-[2px_0_8px_rgba(0,0,0,0.4)]">
                      <span className="font-bold text-white text-sm tracking-tight">{stock.symbol}</span>
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
                          trendPositive={isDayPositive}
                          uniqueId={`spark-${stock.symbol}`}
                        />
                      </div>
                    </td>

                    {/* Day Range (Filled Bar with LTP Thumb) */}
                    <td className="py-3 px-3">
                      <div
                        className="flex flex-col gap-1 w-full max-w-[140px] mx-auto"
                        title={`LTP: ₹${price.toFixed(1)} (${currentPosPct.toFixed(0)}% of range) | Low: ₹${low.toFixed(1)} | High: ₹${high.toFixed(1)} | Open: ₹${open.toFixed(1)}`}
                      >
                        {/* Filled Bar Container */}
                        <div className="w-full h-2 bg-slate-800/90 rounded-full relative overflow-visible border border-white/5">
                          {/* Filled bar from Low up to current LTP */}
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isDayPositive
                                ? 'bg-gradient-to-r from-emerald-600/70 to-emerald-400'
                                : 'bg-gradient-to-r from-rose-600/70 to-rose-400'
                            }`}
                            style={{ width: `${currentPosPct}%` }}
                          />

                          {/* Current Price Thumb Indicator */}
                          <div
                            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full shadow-md z-[1] border border-slate-900 transition-all duration-300 ${
                              isDayPositive
                                ? 'bg-emerald-400 shadow-emerald-500/50'
                                : 'bg-rose-400 shadow-rose-500/50'
                            }`}
                            style={{ left: `${currentPosPct}%` }}
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
                        {getRecoveryChip(recLow)}
                      </div>
                    </td>

                    {/* Fall from Day High */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        {getFallFromHighChip(dropHigh)}
                      </div>
                    </td>

                    {/* Distance from ATH */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end">
                        {getAthDistanceChip(distAth, stock.ath)}
                      </div>
                    </td>

                    {/* Volume */}
                    <td className="py-3 px-4 text-right">
                      <div
                        className="flex items-center justify-end"
                        title={
                          stock.avgVolume1m
                            ? `${rvol > 0 && rvol < 0.5 ? 'Low Volume (<0.5x) | ' : ''}Today: ${formatVolume(stock.todayVolume)} | 30D Avg: ${formatVolume(stock.avgVolume1m)}`
                            : undefined
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono font-bold text-xs tabular-nums ${
                            rvol >= 2.0
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : rvol >= 1.0
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : rvol > 0 && rvol < 0.5
                              ? 'bg-slate-800/80 text-amber-300/80 border border-amber-500/20'
                              : 'bg-slate-800/60 text-gray-400 border border-white/5'
                          }`}
                        >
                          {rvol > 0 ? `${rvol.toFixed(1)}x` : '—'}
                          {rvol >= 2.0 && <FontAwesomeIcon icon={faFire} className="text-[10px] text-amber-400" />}
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
