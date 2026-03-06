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
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 px-5 py-4">
      <div className="flex items-center gap-4">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap shrink-0">Advance / Decline</h3>
        
        {/* Bar — fills remaining space */}
        <div className="relative h-7 rounded-full overflow-hidden bg-slate-800/50 flex flex-1 min-w-0">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${advPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            {advPct > 10 && (
              <span className="text-xs font-bold text-white drop-shadow-sm">{advancing}</span>
            )}
          </motion.div>
          
          {unchPct > 0 && (
            <motion.div
              className="h-full bg-slate-600 flex items-center justify-center"
              initial={{ width: 0 }}
              animate={{ width: `${unchPct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            >
              {unchPct > 8 && (
                <span className="text-[10px] font-bold text-gray-300">{unchanged}</span>
              )}
            </motion.div>
          )}
          
          <motion.div
            className="h-full bg-gradient-to-r from-rose-500/90 to-rose-600/90 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${decPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          >
            {decPct > 10 && (
              <span className="text-xs font-bold text-white drop-shadow-sm">{declining}</span>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
