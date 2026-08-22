'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowTrendUp, faArrowTrendDown, faTrashCan, faStar } from '@fortawesome/free-solid-svg-icons';
import type { ScanRow } from '@/app/actions/charts';

interface BreakoutListProps {
  rows: ScanRow[];
  selectedSymbol: string | null;
  onSelect: (symbol: string) => void;
  holdings: Set<string>;
  custom: Set<string>;
  onRemove?: (symbol: string) => void;
  liveChange?: Map<string, number>;
  livePrice?: Map<string, number>;
  privacyMode?: boolean;
  loading?: boolean;
  /** Symbol to auto-scroll to and pulse; re-triggered whenever flashNonce changes. */
  flashSymbol?: string | null;
  flashNonce?: number;
}

function fmtPrice(v: number): string {
  return v >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : v.toFixed(2);
}

function DirectionTag({ direction }: { direction: ScanRow['direction'] }) {
  if (direction === 'breakout') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-400">
        <FontAwesomeIcon icon={faArrowTrendUp} className="w-2.5 h-2.5" />
        Breakout
      </span>
    );
  }
  if (direction === 'breakdown') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-red-500/15 text-red-400">
        <FontAwesomeIcon icon={faArrowTrendDown} className="w-2.5 h-2.5" />
        Breakdown
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide bg-slate-600/20 text-slate-400">
      Watch
    </span>
  );
}

const RowItem = memo(function RowItem({
  row,
  rank,
  selected,
  isHolding,
  isCustom,
  change,
  price,
  onSelect,
  onRemove,
  privacyMode,
  flashing,
}: {
  row: ScanRow;
  rank: number;
  selected: boolean;
  isHolding: boolean;
  isCustom: boolean;
  change: number;
  price: number;
  onSelect: (s: string) => void;
  onRemove?: (s: string) => void;
  privacyMode?: boolean;
  flashing?: boolean;
}) {
  const up = change >= 0;
  // Volume ratio bar width (capped at 5x for display)
  const volPct = Math.min(100, (row.volRatio / 5) * 100);
  const volColor = row.direction === 'breakdown' ? '#ef4444' : '#10b981';

  return (
    <button
      onClick={() => onSelect(row.symbol)}
      className={`group w-full flex items-center gap-2 px-3 py-2.5 border-b border-white/5 text-left transition-colors ${
        selected ? 'bg-indigo-500/10 border-l-2 border-l-indigo-400' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
      } ${flashing ? 'radar-flash' : ''}`}
    >
      <span className="w-5 text-[11px] tabular-nums text-gray-600 shrink-0 text-right">{rank}</span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-gray-100 truncate">{row.symbol}</span>
          {isHolding && (
            <span className="px-1 py-px rounded text-[8px] font-bold uppercase bg-indigo-500/20 text-indigo-300 shrink-0">
              Held
            </span>
          )}
          {isCustom && !isHolding && (
            <FontAwesomeIcon icon={faStar} className="w-2.5 h-2.5 text-amber-400/70 shrink-0" />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {/* Volume ratio bar */}
          <div className="relative h-1.5 w-16 rounded-full bg-white/5 overflow-hidden shrink-0">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${volPct}%`, backgroundColor: volColor, opacity: 0.7 }} />
          </div>
          <span className="text-[10px] tabular-nums text-gray-500">{row.volRatio.toFixed(1)}× vol</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <DirectionTag direction={row.direction} />
        <div className="flex items-center gap-2">
          {!privacyMode && (
            <span className="text-[11px] tabular-nums text-gray-400">₹{fmtPrice(price)}</span>
          )}
          <span className={`text-[12px] font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? '+' : ''}{change.toFixed(2)}%
          </span>
        </div>
      </div>

      {onRemove && isCustom && !isHolding && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(row.symbol);
          }}
          className="ml-0.5 opacity-0 group-hover:opacity-100 text-red-400/70 hover:text-red-400 transition-opacity shrink-0"
          title="Remove from watchlist"
        >
          <FontAwesomeIcon icon={faTrashCan} className="w-3 h-3" />
        </span>
      )}
    </button>
  );
});

function BreakoutList({
  rows,
  selectedSymbol,
  onSelect,
  holdings,
  custom,
  onRemove,
  liveChange,
  livePrice,
  privacyMode,
  loading,
  flashSymbol,
  flashNonce,
}: BreakoutListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [flashing, setFlashing] = useState<string | null>(null);

  // Scroll the flashed symbol into view and pulse it (re-fires on nonce change).
  useEffect(() => {
    if (!flashSymbol) return;
    const idx = rows.findIndex((r) => r.symbol === flashSymbol);
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    }
    setFlashing(flashSymbol);
    const t = setTimeout(() => setFlashing(null), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashNonce]);

  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10 text-gray-500">
        <FontAwesomeIcon icon={faArrowTrendUp} className="w-6 h-6 mb-3 opacity-40" />
        <p className="text-sm">No symbols to scan yet.</p>
        <p className="text-xs mt-1 text-gray-600">Add symbols to your watchlist or import holdings.</p>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={rows}
      className="h-full"
      itemContent={(index, row) => (
        <RowItem
          row={row}
          rank={index + 1}
          selected={row.symbol === selectedSymbol}
          isHolding={holdings.has(row.symbol)}
          isCustom={custom.has(row.symbol)}
          change={liveChange?.get(row.symbol) ?? row.changePct}
          price={livePrice?.get(row.symbol) ?? row.lastClose}
          onSelect={onSelect}
          onRemove={onRemove}
          privacyMode={privacyMode}
          flashing={flashing === row.symbol}
        />
      )}
    />
  );
}

export default memo(BreakoutList);
