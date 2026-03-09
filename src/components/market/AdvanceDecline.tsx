'use client';

import { motion } from 'framer-motion';

interface AdvanceDeclineProps {
  advancing: number;
  declining: number;
  unchanged: number;
}

export default function AdvanceDecline({ advancing, declining, unchanged }: AdvanceDeclineProps) {
  const total = advancing + declining + unchanged;
  if (total === 0) return null;

  const advPct = (advancing / total) * 100;
  const decPct = (declining / total) * 100;
  const unchPct = (unchanged / total) * 100;

  return (
    <div className="flex flex-col w-full min-w-[280px] sm:min-w-[340px] max-w-[450px] gap-2.5">
      {/* Top Row: Counts */}
      <div className="flex justify-between items-end px-1 font-mono tracking-tight">
        <span className="text-[15px] sm:text-[17px] font-bold text-emerald-400">
          {advancing}
        </span>
        <span className="text-[15px] sm:text-[17px] font-bold text-rose-500">
          {declining}
        </span>
      </div>
      
      {/* Middle Row: Progress Bar */}
      <div className="relative h-3.5 sm:h-4 w-full rounded-full overflow-hidden flex bg-slate-800 shadow-inner">
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
}
