'use client';

import { useMemo, useRef, useEffect, memo } from 'react';
import { motion } from 'framer-motion';

// ============================================================================
// Constants
// ============================================================================

export const SIDEBAR_INDICES = [
  'NIFTY 50',
  'NIFTY500 Momentum 50',
  'NIFTY Total Market',
];

// ============================================================================
// Types
// ============================================================================

interface IndexSummary {
  name: string;
  shortName: string;
  category: string;
  value: number;
  change: number;
  changePercent: number;
}

interface IndexSidebarProps {
  indices: IndexSummary[];
  selectedIndex: string;
  onSelectIndex: (name: string) => void;
  isMobile: boolean;
}

// ============================================================================
// Animated Value (smooth number transitions)
// ============================================================================

function AnimatedValue({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const displayRef = useRef<HTMLSpanElement>(null);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    if (from === to) return;

    const duration = 400;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;

      if (displayRef.current) {
        displayRef.current.textContent = current.toLocaleString('en-IN', {
          maximumFractionDigits: decimals,
          minimumFractionDigits: decimals,
        });
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = to;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [value, decimals]);

  return (
    <span ref={displayRef}>
      {value.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
    </span>
  );
}

// ============================================================================
// Desktop Sidebar Card
// ============================================================================

function SidebarCard({
  idx,
  isSelected,
  onSelect,
  index,
}: {
  idx: IndexSummary;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const isPositive = idx.changePercent >= 0;

  return (
    <motion.button
      onClick={onSelect}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: 'easeOut' }}
      className={`relative w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-200 cursor-pointer ${
        isSelected
          ? 'bg-gradient-to-br from-blue-600/20 via-indigo-500/15 to-violet-500/10 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.12)]'
          : 'bg-slate-900/50 border-white/5 hover:border-white/10 hover:bg-slate-800/40'
      }`}
    >
      <span
        className={`text-[11px] font-medium tracking-wide block truncate ${
          isSelected ? 'text-blue-300' : 'text-gray-400'
        }`}
      >
        {idx.shortName || idx.name}
      </span>

      {idx.value > 0 && (
        <span
          className={`text-[17px] font-extrabold tabular-nums block mt-0.5 ${
            isPositive ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {isPositive ? '+' : ''}
          <AnimatedValue value={idx.changePercent} decimals={2} />%
        </span>
      )}

      <span
        className={`text-[11px] tabular-nums mt-0.5 block ${
          isSelected ? 'text-gray-300' : 'text-gray-500'
        }`}
      >
        {idx.value > 0 ? <AnimatedValue value={idx.value} /> : '—'}
      </span>

      {isSelected && (
        <motion.div
          className="absolute left-0 top-2 bottom-2 w-[3px] bg-gradient-to-b from-blue-500 to-violet-500 rounded-full"
          layoutId="sidebarIndicator"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
    </motion.button>
  );
}

// ============================================================================
// Mobile Pill
// ============================================================================

function MobilePill({
  idx,
  isSelected,
  onSelect,
  index,
}: {
  idx: IndexSummary;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const isPositive = idx.changePercent >= 0;

  // Clear display name for the 3 indices on mobile
  const getShortLabel = (name: string, shortName: string) => {
    if (name.includes('Momentum 50') || name.includes('M50')) return 'Mom 500/50';
    if (name.includes('Total Market')) return 'Total Market';
    if (name.includes('50')) return 'Nifty 50';
    return shortName || name;
  };
  const shortLabel = getShortLabel(idx.name, idx.shortName);

  return (
    <motion.button
      onClick={onSelect}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      className={`w-full min-w-0 flex flex-col items-start px-2.5 py-2 rounded-xl border transition-all duration-200 cursor-pointer ${
        isSelected
          ? 'bg-gradient-to-br from-blue-600/20 via-indigo-500/15 to-violet-500/10 border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
          : 'bg-slate-900/50 border-white/5 hover:border-white/10'
      }`}
    >
      <span className={`text-[10px] sm:text-[11px] font-semibold truncate w-full ${isSelected ? 'text-blue-300' : 'text-gray-400'}`}>
        {shortLabel}
      </span>
      {idx.value > 0 && (
        <span className={`text-[13px] sm:text-[14px] font-extrabold tabular-nums block mt-0.5 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : ''}<AnimatedValue value={idx.changePercent} decimals={2} />%
        </span>
      )}
      <span className={`text-[10px] tabular-nums mt-0.5 block truncate w-full ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
        {idx.value > 0 ? <AnimatedValue value={idx.value} /> : '—'}
      </span>
    </motion.button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default memo(function IndexSidebar({ indices, selectedIndex, onSelectIndex, isMobile }: IndexSidebarProps) {
  // Filter to only the 3 sidebar indices (NIFTY 50, NIFTY500 Momentum 50, NIFTY Total Market)
  const sidebarIndices = useMemo(() => {
    return SIDEBAR_INDICES
      .map(name => indices.find(i => i.name === name))
      .filter((i): i is IndexSummary => !!i);
  }, [indices]);

  if (sidebarIndices.length === 0) return null;

  // Mobile: 3 equal-width cards in a responsive grid
  if (isMobile) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-3 gap-2">
          {sidebarIndices.map((idx, i) => (
            <MobilePill
              key={idx.name}
              idx={idx}
              isSelected={selectedIndex === idx.name}
              onSelect={() => onSelectIndex(idx.name)}
              index={i}
            />
          ))}
        </div>
      </div>
    );
  }

  // Desktop: vertical sidebar
  return (
    <div className="flex flex-col gap-2 w-[220px] shrink-0 sticky top-4 self-start">
      {sidebarIndices.map((idx, i) => (
        <SidebarCard
          key={idx.name}
          idx={idx}
          isSelected={selectedIndex === idx.name}
          onSelect={() => onSelectIndex(idx.name)}
          index={i}
        />
      ))}
    </div>
  );
});
