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
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-5">
      <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Advance / Decline</h3>
      
      {/* Bar */}
      <div className="relative h-8 rounded-full overflow-hidden bg-slate-800/50 flex">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-center"
          initial={{ width: 0 }}
          animate={{ width: `${advPct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          {advPct > 12 && (
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
          {decPct > 12 && (
            <span className="text-xs font-bold text-white drop-shadow-sm">{declining}</span>
          )}
        </motion.div>
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm text-gray-300">
            <span className="font-bold text-emerald-400">{advancing}</span>
            <span className="text-gray-500 ml-1">advancing</span>
          </span>
        </div>
        {unchanged > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
            <span className="text-sm text-gray-300">
              <span className="font-bold text-gray-400">{unchanged}</span>
              <span className="text-gray-500 ml-1">flat</span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-sm text-gray-300">
            <span className="font-bold text-red-400">{declining}</span>
            <span className="text-gray-500 ml-1">declining</span>
          </span>
        </div>
      </div>
    </div>
  );
}
