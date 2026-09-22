'use client';

import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUp,
  faArrowDown,
  faArrowTrendUp,
  faArrowTrendDown,
} from '@fortawesome/free-solid-svg-icons';
import type { IntradayMoverItem } from '@/app/actions/market-breadth';

interface IntradayDynamicsMoversProps {
  topRecoveries?: IntradayMoverItem[];
  topFallers?: IntradayMoverItem[];
  loading?: boolean;
}

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.02, duration: 0.25 },
  }),
};

function formatPrice(price: number): string {
  if (!price || price <= 0) return '-';
  return `₹${price.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRangeBound(val: number): string {
  if (!val || val <= 0) return '-';
  if (val >= 1000) return `₹${val.toFixed(0)}`;
  return `₹${val.toFixed(1)}`;
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
    chipStyle =
      'bg-gradient-to-r from-emerald-500/30 to-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold shadow-sm shadow-cyan-500/20';
  } else if (recLow >= 3.5) {
    chipStyle = 'bg-teal-500/25 text-teal-200 border border-teal-400/40 font-bold';
  } else if (recLow >= 1.5) {
    chipStyle = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-semibold';
  } else {
    chipStyle = 'bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 font-medium';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-[11px] tabular-nums ${chipStyle}`}
    >
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
    chipStyle =
      'bg-rose-500/25 text-rose-200 border border-rose-500/50 font-bold shadow-sm shadow-rose-500/20';
  } else if (dropHigh <= -2.5) {
    chipStyle = 'bg-orange-500/20 text-orange-200 border border-orange-500/35 font-semibold';
  } else if (dropHigh <= -1.0) {
    chipStyle = 'bg-amber-500/15 text-amber-200 border border-amber-500/30 font-medium';
  } else {
    chipStyle = 'bg-emerald-500/15 text-emerald-300/90 border border-emerald-500/25 font-medium';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-[11px] tabular-nums ${chipStyle}`}
    >
      <FontAwesomeIcon icon={faArrowDown} className="text-[9px]" />
      {dropHigh.toFixed(2)}%
    </span>
  );
}

function DynamicMoverRow({
  stock,
  index,
  type,
}: {
  stock: IntradayMoverItem;
  index: number;
  type: 'recovery' | 'fall';
}) {
  const isRecovery = type === 'recovery';
  const price = stock.lastPrice;
  const isDayPositive = stock.changePercent >= 0;

  // Day Range metrics
  const low = Math.min(stock.dayLow || price, price);
  const high = Math.max(stock.dayHigh || price, price);
  const rangeSpan = Math.max(0.01, high - low);
  const currentPosPct = Math.max(0, Math.min(100, ((price - low) / rangeSpan) * 100));

  return (
    <motion.div
      layout
      className="flex items-center justify-between py-2 px-2 sm:px-3 rounded-xl hover:bg-white/[0.03] transition-colors"
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      custom={index}
      title={
        stock.marketCap
          ? `${stock.symbol} • Mcap: ₹${Math.round(stock.marketCap).toLocaleString('en-IN')} Cr\nLTP: ₹${price.toFixed(2)} | Low: ₹${low.toFixed(2)} | High: ₹${high.toFixed(2)}`
          : undefined
      }
    >
      {/* Left: Rank & Stock Symbol */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="text-xs font-mono font-medium text-gray-500 w-4 sm:w-5 text-right shrink-0">
          {index + 1}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-sm text-gray-200 truncate tracking-tight">
            {stock.symbol}
          </span>
          {/* Mobile-only secondary line: LTP */}
          <span className="sm:hidden text-[10px] font-mono text-gray-400">
            {formatPrice(stock.lastPrice)}
          </span>
        </div>
      </div>

      {/* Center: Day Range Bar (visible on sm+) */}
      <div className="hidden sm:flex flex-col gap-1 w-24 md:w-32 shrink-0 px-2">
        <div className="w-full h-1.5 bg-slate-800/90 rounded-full relative overflow-visible border border-white/5">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isDayPositive
                ? 'bg-gradient-to-r from-emerald-600/70 to-emerald-400'
                : 'bg-gradient-to-r from-rose-600/70 to-rose-400'
            }`}
            style={{ width: `${currentPosPct}%` }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border border-slate-900 shadow-sm ${
              isDayPositive ? 'bg-emerald-400 shadow-emerald-500/50' : 'bg-rose-400 shadow-rose-500/50'
            }`}
            style={{ left: `${currentPosPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-gray-500 font-mono leading-none">
          <span>{formatRangeBound(low)}</span>
          <span>{formatRangeBound(high)}</span>
        </div>
      </div>

      {/* Right: LTP & Day Change % + Intraday Metric Chip */}
      <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
        {/* Desktop LTP & Change */}
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs font-mono text-gray-300 tabular-nums font-semibold">
            {formatPrice(stock.lastPrice)}
          </span>
          <span
            className={`text-[10px] font-mono font-medium flex items-center gap-0.5 ${
              isDayPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            <FontAwesomeIcon
              icon={isDayPositive ? faArrowTrendUp : faArrowTrendDown}
              className="text-[8px]"
            />
            {isDayPositive ? '+' : ''}
            {stock.changePercent.toFixed(2)}%
          </span>
        </div>

        {/* Dynamic Metric Chip */}
        <div className="min-w-[76px] sm:min-w-[85px] flex justify-end">
          {isRecovery
            ? getRecoveryChip(stock.recoveryFromLowPct)
            : getFallFromHighChip(stock.fallFromHighPct)}
        </div>
      </div>
    </motion.div>
  );
}

function SkeletonCard({
  title,
  type,
}: {
  title: string;
  type: 'recovery' | 'fall';
}) {
  const isRecovery = type === 'recovery';
  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl animate-pulse">
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isRecovery ? 'bg-emerald-500/50' : 'bg-rose-500/50'
            }`}
          />
          <h3 className="text-sm md:text-base font-semibold text-gray-300">{title}</h3>
          <span className="text-[10px] font-medium text-gray-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
            &gt; ₹1,000 Cr
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-600 px-2 sm:px-3 pb-2 border-b border-white/5">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="w-4 sm:w-5 text-right">#</span>
          <span>Stock</span>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-4">
          <span className="hidden sm:inline text-right">Range</span>
          <span className="hidden sm:inline text-right">Price</span>
          <span className="w-[76px] sm:w-[85px] text-right">
            {isRecovery ? 'From Low' : 'From High'}
          </span>
        </div>
      </div>
      <div className="divide-y divide-white/[0.03] mt-1">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 px-2 sm:px-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-4 sm:w-5 h-3 bg-slate-800/60 rounded" />
              <div className="w-20 h-4 bg-slate-800/60 rounded" />
            </div>
            <div className="flex items-center gap-2.5 sm:gap-4">
              <div className="hidden sm:block w-24 h-3 bg-slate-800/40 rounded" />
              <div className="hidden sm:block w-14 h-3.5 bg-slate-800/40 rounded" />
              <div className="w-16 h-6 bg-slate-800/60 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(function IntradayDynamicsMovers({
  topRecoveries = [],
  topFallers = [],
  loading = false,
}: IntradayDynamicsMoversProps) {
  // Deduplicate items by symbol
  const uniqueRecoveries = useMemo(() => {
    const seen = new Set<string>();
    return (topRecoveries || []).filter((stock) => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return true;
    });
  }, [topRecoveries]);

  const uniqueFallers = useMemo(() => {
    const seen = new Set<string>();
    return (topFallers || []).filter((stock) => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return true;
    });
  }, [topFallers]);

  if (loading && uniqueRecoveries.length === 0 && uniqueFallers.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
        <SkeletonCard title="Top 5 Up from Day Low" type="recovery" />
        <SkeletonCard title="Top 5 Fallen from Day High" type="fall" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
      {/* Card 1: Top 5 Up from Day Low */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <h3 className="text-sm md:text-base font-semibold text-gray-200">
              Top 5 Up from Day Low
            </h3>
            <span className="text-[10px] font-medium text-gray-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
              &gt; ₹1,000 Cr
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500 px-2 sm:px-3 pb-2 border-b border-white/5">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="w-4 sm:w-5 text-right">#</span>
            <span>Stock</span>
          </div>
          <div className="flex items-center gap-2.5 sm:gap-4">
            <span className="hidden sm:inline text-right text-gray-500">Day Range</span>
            <span className="hidden sm:inline text-right">LTP / Chg</span>
            <span className="w-[76px] sm:w-[85px] text-right">From Low</span>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03] mt-1">
          <AnimatePresence mode="popLayout">
            {uniqueRecoveries.slice(0, 5).map((stock, i) => (
              <DynamicMoverRow
                key={`${stock.symbol}-rec`}
                stock={stock}
                index={i}
                type="recovery"
              />
            ))}
          </AnimatePresence>
          {uniqueRecoveries.length === 0 && (
            <p className="text-gray-500 text-sm py-6 text-center">No stocks recovering from low</p>
          )}
        </div>
      </div>

      {/* Card 2: Top 5 Fallen from Day High */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <h3 className="text-sm md:text-base font-semibold text-gray-200">
              Top 5 Fallen from Day High
            </h3>
            <span className="text-[10px] font-medium text-gray-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
              &gt; ₹1,000 Cr
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500 px-2 sm:px-3 pb-2 border-b border-white/5">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="w-4 sm:w-5 text-right">#</span>
            <span>Stock</span>
          </div>
          <div className="flex items-center gap-2.5 sm:gap-4">
            <span className="hidden sm:inline text-right text-gray-500">Day Range</span>
            <span className="hidden sm:inline text-right">LTP / Chg</span>
            <span className="w-[76px] sm:w-[85px] text-right">From High</span>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03] mt-1">
          <AnimatePresence mode="popLayout">
            {uniqueFallers.slice(0, 5).map((stock, i) => (
              <DynamicMoverRow
                key={`${stock.symbol}-fall`}
                stock={stock}
                index={i}
                type="fall"
              />
            ))}
          </AnimatePresence>
          {uniqueFallers.length === 0 && (
            <p className="text-gray-500 text-sm py-6 text-center">No stocks fallen from high</p>
          )}
        </div>
      </div>
    </div>
  );
});
