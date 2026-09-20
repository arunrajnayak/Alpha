'use client';

import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TopMoverItem {
  symbol: string;
  changePercent: number;
  lastPrice: number;
  marketCap?: number;
}

interface TopMoversProps {
  topGainers?: TopMoverItem[];
  topLosers?: TopMoverItem[];
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

function MoverRow({
  stock,
  index,
  type,
}: {
  stock: TopMoverItem;
  index: number;
  type: 'gain' | 'loss';
}) {
  const isGain = type === 'gain';
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
          ? `${stock.symbol} • Mcap: ₹${Math.round(stock.marketCap).toLocaleString('en-IN')} Cr`
          : undefined
      }
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="text-xs font-mono font-medium text-gray-500 w-4 sm:w-5 text-right shrink-0">
          {index + 1}
        </span>
        <span className="font-semibold text-sm text-gray-200 truncate tracking-tight">
          {stock.symbol}
        </span>
      </div>
      <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
        <span className="text-xs font-mono text-gray-400 tabular-nums">
          {formatPrice(stock.lastPrice)}
        </span>
        <span
          className={`text-xs font-bold font-mono px-2 sm:px-2.5 py-0.5 rounded-md min-w-[62px] sm:min-w-[70px] text-right ${
            isGain
              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
              : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
          }`}
        >
          {isGain ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </div>
    </motion.div>
  );
}

function SkeletonCard({ title, type }: { title: string; type: 'gain' | 'loss' }) {
  const isGain = type === 'gain';
  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl animate-pulse">
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isGain ? 'bg-emerald-500/50' : 'bg-rose-500/50'
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
          <span className="text-right">Price</span>
          <span className="w-[62px] sm:w-[70px] text-right">Change</span>
        </div>
      </div>
      <div className="divide-y divide-white/[0.03] mt-1">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 px-2 sm:px-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-4 sm:w-5 h-3 bg-slate-800/60 rounded" />
              <div className="w-20 h-4 bg-slate-800/60 rounded" />
            </div>
            <div className="flex items-center gap-2.5 sm:gap-4">
              <div className="w-14 h-3.5 bg-slate-800/40 rounded" />
              <div className="w-16 h-6 bg-slate-800/60 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(function TopMovers({
  topGainers = [],
  topLosers = [],
  loading = false,
}: TopMoversProps) {
  // Deduplicate gainers/losers by symbol to prevent any duplicate key errors in AnimatePresence
  const uniqueGainers = useMemo(() => {
    const seen = new Set<string>();
    return (topGainers || []).filter(stock => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return true;
    });
  }, [topGainers]);

  const uniqueLosers = useMemo(() => {
    const seen = new Set<string>();
    return (topLosers || []).filter(stock => {
      if (!stock.symbol || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return true;
    });
  }, [topLosers]);

  if (loading && uniqueGainers.length === 0 && uniqueLosers.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
        <SkeletonCard title="Top 10 Gainers" type="gain" />
        <SkeletonCard title="Top 10 Losers" type="loss" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
      {/* Top 10 Gainers */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <h3 className="text-sm md:text-base font-semibold text-gray-200">Top 10 Gainers</h3>
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
            <span className="text-right">Price</span>
            <span className="w-[62px] sm:w-[70px] text-right">Change</span>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03] mt-1">
          <AnimatePresence mode="popLayout">
            {uniqueGainers.slice(0, 10).map((stock, i) => (
              <MoverRow key={`${stock.symbol}-gain`} stock={stock} index={i} type="gain" />
            ))}
          </AnimatePresence>
          {uniqueGainers.length === 0 && (
            <p className="text-gray-500 text-sm py-6 text-center">No gainers</p>
          )}
        </div>
      </div>

      {/* Top 10 Losers */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6 backdrop-blur-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5 sm:pb-3 mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <h3 className="text-sm md:text-base font-semibold text-gray-200">Top 10 Losers</h3>
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
            <span className="text-right">Price</span>
            <span className="w-[62px] sm:w-[70px] text-right">Change</span>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03] mt-1">
          <AnimatePresence mode="popLayout">
            {uniqueLosers.slice(0, 10).map((stock, i) => (
              <MoverRow key={`${stock.symbol}-loss`} stock={stock} index={i} type="loss" />
            ))}
          </AnimatePresence>
          {uniqueLosers.length === 0 && (
            <p className="text-gray-500 text-sm py-6 text-center">No losers</p>
          )}
        </div>
      </div>
    </div>
  );
});
