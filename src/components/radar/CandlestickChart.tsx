'use client';

import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import type { Candle, Pivot, Timeframe, SwingLabel, PivotType, BreakoutDirection } from '@/lib/charts/candles';

const UP = '#10b981';
const DOWN = '#ef4444';
const GRID = '#1f2937';
const AXIS = '#6b7280';

interface CandlestickChartProps {
  candles: Candle[];
  pivots: Pivot[];
  donchianHigh: number | null;
  donchianLow: number | null;
  timeframe: Timeframe;
  height?: number;
  breakoutStartIndex?: number;
  breakoutDirection?: BreakoutDirection;
  /** Changing this (e.g. `${symbol}-${timeframe}`) resets zoom/pan to the full view. */
  resetKey?: string;
}

const MIN_CANDLES = 8;

interface Row {
  i: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  up: boolean;
  range: [number, number]; // [low, high] — drives the range bar geometry
  pivot?: SwingLabel;
  pivotType?: PivotType;
}

function fmtPrice(v: number): string {
  return v >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : v.toFixed(2);
}

const SWING_DESC: Record<SwingLabel, string> = {
  HH: 'Higher High',
  HL: 'Higher Low',
  LH: 'Lower High',
  LL: 'Lower Low',
};

function CandleTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const d: Row | undefined = payload[0]?.payload;
  if (!d) return null;
  const color = d.up ? UP : DOWN;
  const chg = d.open ? ((d.close - d.open) / d.open) * 100 : 0;
  const swingBull = d.pivot === 'HH' || d.pivot === 'HL';
  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 shadow-2xl text-[11px]">
      <p className="text-gray-400 mb-1.5 font-medium">{d.label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
        <span className="text-gray-500">O</span><span className="text-gray-200 text-right">{fmtPrice(d.open)}</span>
        <span className="text-gray-500">H</span><span className="text-gray-200 text-right">{fmtPrice(d.high)}</span>
        <span className="text-gray-500">L</span><span className="text-gray-200 text-right">{fmtPrice(d.low)}</span>
        <span className="text-gray-500">C</span>
        <span className="text-right font-semibold" style={{ color }}>{fmtPrice(d.close)}</span>
        <span className="text-gray-500">Chg</span>
        <span className="text-right font-semibold" style={{ color }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
        <span className="text-gray-500">Vol</span>
        <span className="text-gray-200 text-right">{d.volume.toLocaleString('en-IN')}</span>
      </div>
      {d.pivot && (
        <div className="mt-1.5 pt-1.5 border-t border-white/8 flex items-center justify-between gap-3">
          <span className="text-gray-500">Swing</span>
          <span className="font-bold" style={{ color: swingBull ? UP : DOWN }}>
            {d.pivot} · {SWING_DESC[d.pivot]}
          </span>
        </div>
      )}
    </div>
  );
}

/** Custom label for the breakout/breakdown ReferenceLine, anchored INSIDE the
 *  plot (to the left of the line) so it never clips at the right edge. */
function BreakoutLabel(props: any) {
  const { viewBox, value, color } = props;
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <text x={x - 6} y={y + 11} textAnchor="end" fill={color} fontSize={9} fontWeight={700}>
      {value}
    </text>
  );
}

/**
 * Custom candle renderer. Recharts positions the range bar between `low` and
 * `high`, so `y`=pixel(high) and `y+height`=pixel(low). We interpolate the
 * open/close pixels from that, and use the bar `background` (full plot column)
 * to anchor a small volume bar at the bottom — no internal axis-scale access,
 * so this is robust across recharts versions (v3-safe).
 */
function CandleShape(props: any) {
  const { x, width, y, height, payload, background, volMax, activeIndex } = props;
  if (!payload || width == null || height == null) return null;

  const { open, high, low, close, up, volume, pivot, pivotType, i } = payload as Row;
  const color = up ? UP : DOWN;
  const active = activeIndex === i;
  const cx = x + width / 2;
  const span = high - low || 1;
  const priceToY = (p: number) => y + ((high - p) / span) * height;

  const yOpen = priceToY(open);
  const yClose = priceToY(close);
  const bodyTop = Math.min(yOpen, yClose);
  const bodyH = Math.max(1, Math.abs(yClose - yOpen));
  const bodyW = Math.max(1.5, Math.min(14, width * 0.7));

  // Volume sub-bar anchored to the bottom of the plotting column (~18% tall).
  // On hover the bar brightens from its faint resting state to a vivid glow.
  let volRect = null;
  if (background && typeof background.height === 'number' && volMax > 0) {
    const volH = (volume / volMax) * (background.height * 0.18);
    const volY = background.y + background.height - volH;
    volRect = (
      <rect
        x={cx - bodyW / 2}
        y={volY}
        width={bodyW}
        height={volH}
        fill={color}
        opacity={active ? 0.85 : 0.22}
      />
    );
  }

  // Swing label (HH/HL/LH/LL)
  let pivotEl = null;
  if (pivot) {
    const isHigh = pivotType === 'high';
    const py = priceToY(isHigh ? high : low) + (isHigh ? -8 : 14);
    const bullish = pivot === 'HH' || pivot === 'HL';
    pivotEl = (
      <text x={cx} y={py} textAnchor="middle" fontSize={9} fontWeight={700} fill={bullish ? UP : DOWN} opacity={0.9}>
        {pivot}
      </text>
    );
  }

  return (
    <g style={active ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}>
      {volRect}
      <line
        x1={cx}
        x2={cx}
        y1={priceToY(high)}
        y2={priceToY(low)}
        stroke={color}
        strokeWidth={active ? 1.6 : 1}
        opacity={active ? 1 : 0.9}
      />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} rx={0.5} />
      {pivotEl}
    </g>
  );
}

/** A tiny candlestick glyph used in the legend. */
function CandleGlyph({ up }: { up: boolean }) {
  const c = up ? UP : DOWN;
  return (
    <svg width="9" height="15" viewBox="0 0 9 15" className="shrink-0">
      <line x1="4.5" x2="4.5" y1="0.5" y2="14.5" stroke={c} strokeWidth="1.2" />
      <rect x="1.5" y="4" width="6" height="7" rx="1.2" fill={c} />
    </svg>
  );
}

function LegendDivider() {
  return <span className="hidden md:inline-block w-px h-3.5 bg-white/10 mx-0.5" />;
}

/** Bottom legend explaining the chart's markers and terminology. */
function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 border-t border-white/5 px-3 pt-2.5 text-[10.5px] font-medium text-gray-400">
      <span className="flex items-center gap-1.5">
        <CandleGlyph up />
        <span>Bullish</span>
      </span>
      <span className="flex items-center gap-1.5">
        <CandleGlyph up={false} />
        <span>Bearish</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="flex items-end gap-[2px] h-3.5" aria-hidden>
          <span className="w-[3px] h-2 rounded-[1px] bg-gray-400/35" />
          <span className="w-[3px] h-3.5 rounded-[1px] bg-gray-400/35" />
          <span className="w-[3px] h-1.5 rounded-[1px] bg-gray-400/35" />
        </span>
        <span>Volume</span>
      </span>

      <LegendDivider />

      <span className="flex items-center gap-1.5">
        <span className="font-bold tracking-tight" style={{ color: UP }}>HH·HL</span>
        <span className="text-gray-500">Higher high / low</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-bold tracking-tight" style={{ color: DOWN }}>LH·LL</span>
        <span className="text-gray-500">Lower high / low</span>
      </span>

      <LegendDivider />

      <span className="flex items-center gap-1.5">
        <span className="inline-flex flex-col justify-center gap-[3px]" aria-hidden>
          <span className="w-5 border-t border-dashed" style={{ borderColor: UP }} />
          <span className="w-5 border-t border-dashed" style={{ borderColor: DOWN }} />
        </span>
        <span className="text-gray-500">Donchian H / L</span>
      </span>

      <LegendDivider />

      <span className="flex items-center gap-1.5">
        <span className="font-bold" style={{ color: UP }}>▲ BO</span>
        <span className="font-bold" style={{ color: DOWN }}>▼ BD</span>
        <span className="text-gray-500">Breakout / breakdown start</span>
      </span>
    </div>
  );
}

const CandlestickChart = memo(function CandlestickChart({
  candles,
  pivots,
  donchianHigh,
  donchianLow,
  timeframe,
  height = 460,
  breakoutStartIndex,
  breakoutDirection,
  resetKey,
}: CandlestickChartProps) {
  // Daily / weekly / monthly are date-only; the rest are intraday (show time).
  const intraday = timeframe !== '1D' && timeframe !== '1W' && timeframe !== '1M';

  const containerRef = useRef<HTMLDivElement>(null);
  // `null` = full/default view (auto-follows new candles). Otherwise an explicit
  // [start, end] window (inclusive indices into `rows`) for zoom/pan.
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);
  const dragRef = useRef<{ x: number; start: number; size: number } | null>(null);

  // Reset zoom whenever the stock/timeframe changes.
  useEffect(() => {
    setView(null);
    setHoverI(null);
  }, [resetKey]);

  const rows: Row[] = useMemo(() => {
    const pivotByIndex = new Map<number, Pivot>();
    for (const p of pivots) pivotByIndex.set(p.index, p);
    return candles.map((c, i) => {
      const piv = pivotByIndex.get(i);
      return {
        i,
        label: format(new Date(c.time), intraday ? 'dd MMM HH:mm' : 'dd MMM yyyy'),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        up: c.close >= c.open,
        range: [c.low, c.high] as [number, number],
        pivot: piv?.label,
        pivotType: piv?.type,
      };
    });
  }, [candles, pivots, intraday]);

  // Clamp a window to valid bounds; collapse to full view when it spans everything.
  const clampView = useCallback(
    (start: number, size: number): { start: number; end: number } | null => {
      const len = rows.length;
      const s = Math.min(len, Math.max(MIN_CANDLES, Math.round(size)));
      if (s >= len) return null;
      const st = Math.min(len - s, Math.max(0, Math.round(start)));
      return { start: st, end: st + s - 1 };
    },
    [rows.length],
  );

  // The candles actually rendered (zoom window applied). Auto-scales Y to fit.
  const visibleRows = useMemo(() => {
    if (!view) return rows;
    return rows.slice(view.start, view.end + 1);
  }, [rows, view]);

  const { priceMin, priceMax, volMax } = useMemo(() => {
    if (visibleRows.length === 0) return { priceMin: 0, priceMax: 1, volMax: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    let vHi = 0;
    for (const r of visibleRows) {
      if (r.low < lo) lo = r.low;
      if (r.high > hi) hi = r.high;
      if (r.volume > vHi) vHi = r.volume;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    return { priceMin: lo - pad, priceMax: hi + pad, volMax: vHi || 1 };
  }, [visibleRows]);

  const tickInterval = Math.max(0, Math.floor(visibleRows.length / 7) - 1);

  // Approx plot paddings (chart margins + right YAxis width) for mouse→index mapping.
  const LEFT_PAD = 6;
  const RIGHT_PAD = 60;

  const zoomAt = useCallback(
    (clientX: number, factor: number) => {
      const el = containerRef.current;
      const len = rows.length;
      if (!el || len === 0) return;
      const cur = view ?? { start: 0, end: len - 1 };
      const size = cur.end - cur.start + 1;
      const rect = el.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - LEFT_PAD - RIGHT_PAD);
      let frac = (clientX - rect.left - LEFT_PAD) / plotW;
      frac = Math.min(1, Math.max(0, frac));
      const centerIdx = cur.start + frac * (size - 1);
      const newSize = size * factor;
      const nextStart = centerIdx - frac * (newSize - 1);
      setView(clampView(nextStart, newSize));
    },
    [rows.length, view, clampView],
  );

  // Native (non-passive) wheel listener so we can preventDefault the page scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.deltaY < 0 ? 0.82 : 1 / 0.82);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const zoomButton = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      zoomAt(rect ? rect.left + rect.width / 2 : 0, factor);
    },
    [zoomAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const len = rows.length;
      const cur = view ?? { start: 0, end: len - 1 };
      const size = cur.end - cur.start + 1;
      if (size >= len) return; // nothing to pan when fully zoomed out
      dragRef.current = { x: e.clientX, start: cur.start, size };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [rows.length, view],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - LEFT_PAD - RIGHT_PAD);
      const candlePx = plotW / drag.size;
      const deltaIdx = -(e.clientX - drag.x) / candlePx;
      setView(clampView(drag.start + deltaIdx, drag.size));
    },
    [clampView],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No candle data available
      </div>
    );
  }

  const zoomed = view != null;
  const isPannable = zoomed;

  return (
    <div
      ref={containerRef}
      className={`radar-chart relative select-none flex flex-col outline-none ${isPannable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ height: '100%', minHeight: height, touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={visibleRows}
        margin={{ top: 10, right: 8, left: 4, bottom: 4 }}
        barCategoryGap="18%"
        onMouseMove={(s: any) => {
          const idx = s?.activeTooltipIndex;
          const r = idx != null ? visibleRows[Number(idx)] : undefined;
          setHoverI(r ? r.i : null);
        }}
        onMouseLeave={() => setHoverI(null)}
      >
        <XAxis
          dataKey="i"
          type="category"
          tickFormatter={(i) => {
            const lbl = rows[i as number]?.label ?? '';
            return intraday ? lbl.replace(/^\d{2} \w{3} /, '') : lbl.replace(/ \d{4}$/, '');
          }}
          tick={{ fill: AXIS, fontSize: 10 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          interval={tickInterval}
          minTickGap={16}
        />
        <YAxis
          yAxisId="price"
          orientation="right"
          domain={[priceMin, priceMax]}
          tick={{ fill: AXIS, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={52}
          allowDecimals
          tickFormatter={(v) => fmtPrice(v as number)}
        />

        <Tooltip content={<CandleTooltip />} cursor={{ fill: '#ffffff', fillOpacity: 0.04 }} />

        {donchianHigh != null && (
          <ReferenceLine
            yAxisId="price"
            y={donchianHigh}
            stroke={UP}
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{ value: 'DC High', position: 'insideTopLeft', fill: UP, fontSize: 9 }}
          />
        )}
        {donchianLow != null && (
          <ReferenceLine
            yAxisId="price"
            y={donchianLow}
            stroke={DOWN}
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{ value: 'DC Low', position: 'insideBottomLeft', fill: DOWN, fontSize: 9 }}
          />
        )}

        {/* Where the current breakout / breakdown began */}
        {typeof breakoutStartIndex === 'number' &&
          breakoutStartIndex >= 0 &&
          breakoutDirection &&
          breakoutDirection !== 'none' && (
            <ReferenceLine
              yAxisId="price"
              x={breakoutStartIndex}
              stroke={breakoutDirection === 'breakdown' ? DOWN : UP}
              strokeDasharray="3 3"
              strokeOpacity={0.75}
              label={
                <BreakoutLabel
                  value={breakoutDirection === 'breakdown' ? '▼ BD start' : '▲ BO start'}
                  color={breakoutDirection === 'breakdown' ? DOWN : UP}
                />
              }
            />
          )}

        {/* Single range bar → custom candle + volume + swing-label renderer */}
        <Bar
          yAxisId="price"
          dataKey="range"
          isAnimationActive={false}
          background={{ fill: 'transparent' }}
          shape={(p: any) => <CandleShape {...p} volMax={volMax} activeIndex={hoverI} />}
        />
      </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* Zoom toolbar — a thin, centered strip between the chart and the legend */}
      <div
        className="relative flex items-center justify-center border-t border-white/5 py-1.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center rounded-lg border border-white/10 bg-slate-800/70 backdrop-blur-sm shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => zoomButton(0.7)}
            title="Zoom in"
            className="h-6 w-9 grid place-items-center text-gray-300 hover:text-white hover:bg-white/10 transition-colors text-base leading-none"
          >
            +
          </button>
          <span className="w-px h-4 bg-white/10" />
          <button
            type="button"
            onClick={() => zoomButton(1 / 0.7)}
            title="Zoom out"
            className="h-6 w-9 grid place-items-center text-gray-300 hover:text-white hover:bg-white/10 transition-colors text-base leading-none"
          >
            −
          </button>
          <span className="w-px h-4 bg-white/10" />
          <button
            type="button"
            onClick={() => setView(null)}
            disabled={!zoomed}
            title="Reset zoom"
            className="h-6 px-2.5 grid place-items-center text-[10px] font-semibold tracking-wide text-gray-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-default"
          >
            RESET
          </button>
        </div>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:inline text-[9.5px] text-gray-600">
          scroll · drag
        </span>
      </div>

      <ChartLegend />
    </div>
  );
});

export default CandlestickChart;
