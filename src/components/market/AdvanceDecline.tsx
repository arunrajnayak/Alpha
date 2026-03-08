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
    <div className="relative h-6 w-full rounded-full overflow-hidden bg-slate-800/50 flex shadow-inner">
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
            className="h-full bg-gradient-to-r from-red-500 to-red-600 flex items-center justify-center"
            initial={{ width: 0 }}
            animate={{ width: `${decPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          >
            {decPct > 10 && (
              <span className="text-xs font-bold text-white drop-shadow-sm">{declining}</span>
            )}
          </motion.div>
    </div>
  );
}
