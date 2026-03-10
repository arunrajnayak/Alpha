'use client';

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TopMoversProps {
  topGainers: Array<{
    symbol: string;
    lastPrice: number;
    changePercent: number;
    change: number;
  }>;
  topLosers: Array<{
    symbol: string;
    lastPrice: number;
    changePercent: number;
    change: number;
  }>;
  totalConstituents: number;
  isMobile: boolean;
}

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.03, duration: 0.3 },
  }),
};

function MoverRow({ stock, index, type }: { stock: { symbol: string; changePercent: number }; index: number; type: 'gain' | 'loss' }) {
  const isGain = type === 'gain';
  return (
    <motion.div
      layout
      className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      custom={index}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[10px] font-medium text-gray-600 w-5 text-right">{index + 1}</span>
        <span className="font-semibold text-sm text-gray-200 truncate">{stock.symbol}</span>
      </div>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-md min-w-[60px] text-right ${
        isGain
          ? 'text-emerald-400 bg-emerald-500/10'
          : 'text-red-400 bg-red-500/10'
      }`}>
        {isGain ? '+' : ''}{stock.changePercent.toFixed(2)}%
      </span>
    </motion.div>
  );
}

export default memo(function TopMovers({ topGainers, topLosers, totalConstituents, isMobile }: TopMoversProps) {
  if (topGainers.length === 0 && topLosers.length === 0) return null;

  const display = isMobile ? 5 : (totalConstituents < 200 ? 5 : 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Top Gainers */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-5">
        <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <h3 className="text-sm font-semibold text-gray-200">Top Gainers</h3>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03]">
          <AnimatePresence mode="popLayout">
            {topGainers.slice(0, display).map((stock, i) => (
              <MoverRow key={stock.symbol} stock={stock} index={i} type="gain" />
            ))}
          </AnimatePresence>
          {topGainers.length === 0 && (
            <p className="text-gray-500 text-sm py-4 text-center">No gainers</p>
          )}
        </div>
      </div>

      {/* Top Losers */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-5">
        <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <h3 className="text-sm font-semibold text-gray-200">Top Losers</h3>
          </div>
        </div>
        <div className="divide-y divide-white/[0.03]">
          <AnimatePresence mode="popLayout">
            {topLosers.slice(0, display).map((stock, i) => (
              <MoverRow key={stock.symbol} stock={stock} index={i} type="loss" />
            ))}
          </AnimatePresence>
          {topLosers.length === 0 && (
            <p className="text-gray-500 text-sm py-4 text-center">No losers</p>
          )}
        </div>
      </div>
    </div>
  );
});
