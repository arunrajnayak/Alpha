'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';

interface AdvanceDeclineProps {
  advancing: number;
  declining: number;
  unchanged: number;
}

export default memo(function AdvanceDecline({ advancing, declining, unchanged }: AdvanceDeclineProps) {
  const total = advancing + declining + unchanged;
  if (total === 0) return null;

  const advPct = (advancing / total) * 100;
  const decPct = (declining / total) * 100;
  const unchPct = (unchanged / total) * 100;

  return (
    <div className="flex flex-col w-full min-w-0 gap-1.5">
      {/* Top Row: Counts */}
      <div className="flex justify-between items-end px-0.5 font-mono tracking-tight text-xs">
        <span className="font-bold text-emerald-400">
          {advancing} <span className="text-[10px] font-sans font-medium text-emerald-400/70">adv</span>
        </span>
        {unchanged > 0 && (
          <span className="text-[10px] font-sans text-gray-400 font-medium">
            {unchanged} unch
          </span>
        )}
        <span className="font-bold text-rose-500">
          {declining} <span className="text-[10px] font-sans font-medium text-rose-400/70">dec</span>
        </span>
      </div>
      
      {/* Middle Row: Progress Bar */}
      <div className="relative h-2.5 sm:h-3 w-full rounded-full overflow-hidden flex bg-slate-800 shadow-inner">
        <motion.div
          className="h-full bg-emerald-400"
          initial={{ width: 0 }}
          animate={{ width: `${advPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        
        {unchPct > 0 && (
          <motion.div
            className="h-full bg-slate-600/[0.8]"
            initial={{ width: 0 }}
            animate={{ width: `${unchPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
          />
        )}
        
        <motion.div
          className="h-full bg-rose-500"
          initial={{ width: 0 }}
          animate={{ width: `${decPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
    </div>
  );
});
