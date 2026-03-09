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
    <div className="flex flex-col w-full max-w-sm gap-2">
      <div className="flex justify-between items-end px-1">
        <div className="flex items-baseline gap-1.5 text-emerald-400">
          <span className="text-sm font-bold">{advancing}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Adv</span>
        </div>
        {unchanged > 0 && (
          <div className="flex items-baseline gap-1.5 text-slate-400">
            <span className="text-sm font-bold">{unchanged}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Unch</span>
          </div>
        )}
        <div className="flex items-baseline gap-1.5 text-rose-400">
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Dec</span>
          <span className="text-sm font-bold">{declining}</span>
        </div>
      </div>
      
      <div className="relative h-2.5 w-full rounded-full overflow-hidden bg-slate-800/80 flex shadow-inner ring-1 ring-white/5">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.3)] relative"
          initial={{ width: 0 }}
          animate={{ width: `${advPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <div className="absolute inset-0 bg-white/10" />
        </motion.div>
        
        {unchPct > 0 && (
          <motion.div
            className="h-full bg-slate-600 relative"
            initial={{ width: 0 }}
            animate={{ width: `${unchPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
          />
        )}
        
        <motion.div
          className="h-full bg-gradient-to-r from-rose-400 to-rose-500 shadow-[0_0_10px_rgba(251,113,133,0.3)] border-l border-slate-900/20 relative"
          initial={{ width: 0 }}
          animate={{ width: `${decPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        >
          <div className="absolute inset-0 bg-white/10" />
        </motion.div>
      </div>
    </div>
  );
}
