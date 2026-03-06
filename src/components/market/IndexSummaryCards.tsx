'use client';

import { useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';

interface IndexSummary {
  name: string;
  shortName: string;
  category: string;
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

/**
 * Animated number that smoothly transitions between values
 */
function AnimatedValue({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const displayRef = useRef<HTMLSpanElement>(null);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    if (from === to) return;

    const duration = 400; // ms
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
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

function IndexCardGrid({ 
  indices, 
  selectedIndex, 
  onSelectIndex, 
  isMobile,
  clickable,
}: { 
  indices: IndexSummary[]; 
  selectedIndex: string; 
  onSelectIndex: (name: string) => void; 
  isMobile: boolean;
  clickable: boolean;
}) {
  if (indices.length === 0) return null;

  // Row-sequence layout: items fill left-to-right across rows
  const cols = isMobile ? indices.length : Math.ceil(indices.length / 2);

  return (
    <div className="overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-700">
      <div
        className="gap-2.5"
        style={{
          display: 'grid',
          gridTemplateRows: isMobile ? '1fr' : '1fr 1fr',
          gridTemplateColumns: `repeat(${cols}, minmax(${isMobile ? '115px' : '120px'}, 1fr))`,
        }}
      >
        {indices.map((idx, i) => {
          const isSelected = clickable && selectedIndex === idx.name;
          const isPositive = idx.changePercent >= 0;

          return (
            <motion.div
              key={idx.name}
              onClick={clickable ? () => onSelectIndex(idx.name) : undefined}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.015, duration: 0.2 }}
              className={`relative flex flex-col items-start px-3 py-2.5 rounded-xl border transition-all duration-200 text-left ${
                clickable ? 'cursor-pointer' : ''
              } ${
                isSelected
                  ? 'bg-gradient-to-br from-blue-600/20 via-indigo-500/15 to-violet-500/10 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.12)]'
                  : 'bg-slate-900/50 border-white/5 hover:border-white/10 hover:bg-slate-800/40'
              }`}
            >
              <span className={`text-[10px] font-medium tracking-wide mb-1 truncate w-full ${
                isSelected ? 'text-blue-300' : 'text-gray-400'
              }`}>
                {idx.shortName}
              </span>
              {idx.value > 0 && (
                <span className={`text-[15px] font-extrabold tabular-nums ${
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {isPositive ? '+' : ''}<AnimatedValue value={idx.changePercent} decimals={2} />%
                </span>
              )}
              <span className={`text-[11px] tabular-nums mt-0.5 ${
                isSelected ? 'text-gray-300' : 'text-gray-500'
              }`}>
                {idx.value > 0 ? <AnimatedValue value={idx.value} /> : '—'}
              </span>
              {isSelected && (
                <motion.div
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500 rounded-full"
                  layoutId="indexIndicator"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default function IndexSummaryCards({ indices, selectedIndex, onSelectIndex, isMobile }: IndexSummaryCardsProps) {
  if (indices.length === 0) return null;

  const groups = useMemo(() => {
    const broad = indices
      .filter(i => i.category === 'broad' || i.category === 'momentum')
      .sort((a, b) => a.changePercent - b.changePercent);
    const sectoral = indices
      .filter(i => i.category === 'sectoral')
      .sort((a, b) => a.changePercent - b.changePercent);
    return { broad, sectoral };
  }, [indices]);

  return (
    <div className="flex flex-col gap-3">
      {/* Broad + Momentum Indices — clickable */}
      <IndexCardGrid
        indices={groups.broad}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
        isMobile={isMobile}
        clickable={true}
      />

      {/* Sectoral Indices — display only, not clickable */}
      {groups.sectoral.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5 block pl-0.5">Sectoral</span>
          <IndexCardGrid
            indices={groups.sectoral}
            selectedIndex={selectedIndex}
            onSelectIndex={onSelectIndex}
            isMobile={isMobile}
            clickable={false}
          />
        </div>
      )}
    </div>
  );
}
