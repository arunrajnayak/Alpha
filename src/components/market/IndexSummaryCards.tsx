'use client';

import { motion } from 'framer-motion';

interface IndexSummary {
  name: string;
  shortName: string;
  value: number;
  change: number;
  changePercent: number;
}

interface IndexSummaryCardsProps {
  indices: IndexSummary[];
  selectedIndex: string;
  onSelectIndex: (name: string) => void;
  isMobile: boolean;
}

export default function IndexSummaryCards({ indices, selectedIndex, onSelectIndex, isMobile }: IndexSummaryCardsProps) {
  if (indices.length === 0) return null;

  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-slate-700">
      <div className={`flex gap-3 ${isMobile ? 'min-w-max' : 'flex-wrap'}`}>
        {indices.map((idx, i) => {
          const isSelected = selectedIndex === idx.name;
          const isPositive = idx.changePercent >= 0;

          return (
            <motion.button
              key={idx.name}
              onClick={() => onSelectIndex(idx.name)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className={`relative flex flex-col items-start px-4 py-3 rounded-xl border transition-all duration-200 min-w-[140px] shrink-0 text-left ${
                isSelected
                  ? 'bg-gradient-to-br from-blue-600/20 via-indigo-500/15 to-violet-500/10 border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                  : 'bg-slate-900/50 border-white/5 hover:border-white/10 hover:bg-slate-800/40'
              }`}
            >
              <span className={`text-[11px] font-medium tracking-wide mb-1 ${
                isSelected ? 'text-blue-300' : 'text-gray-400'
              }`}>
                {idx.shortName}
              </span>
              <span className={`text-sm font-bold tabular-nums ${
                isSelected ? 'text-white' : 'text-gray-200'
              }`}>
                {idx.value > 0 ? idx.value.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
              </span>
              {idx.value > 0 && (
                <span className={`text-[11px] font-bold tabular-nums mt-0.5 ${
                  isPositive ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {isPositive ? '+' : ''}{idx.changePercent.toFixed(2)}%
                </span>
              )}
              {isSelected && (
                <motion.div
                  className="absolute bottom-0 left-3 right-3 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500 rounded-full"
                  layoutId="indexIndicator"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
