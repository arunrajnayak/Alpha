'use client';

import { ResponsiveTreeMap } from '@nivo/treemap';
import { ResponsivePie } from '@nivo/pie';
import { formatNumber } from '@/lib/format';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

type Holding = {
  symbol: string;
  currentValue: number;
  dayChangePercent: number;
  marketCapCategory?: string;
  sector?: string;
  formattedValue: string;
};

interface PortfolioHeatmapProps {
  data: {
    allHoldings: Array<Holding>;
  };
  isMobile: boolean;
  privacyMode: boolean;
}

type ViewMode = 'treemap' | 'allocation' | 'bars';

const VIEW_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: 'treemap', label: 'Treemap' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'bars', label: 'Bars' },
];

const STORAGE_KEY = 'portfolioHeatmapView';

/** Background color for a given day-change percentage. */
function colorFor(percent: number | undefined): string {
  if (percent === undefined) return 'rgba(0,0,0,0)';
  if (percent >= 10) return '#059669';
  if (percent >= 5) return '#10b981';
  if (percent >= 3) return '#34d399';
  if (percent >= 1.5) return '#6ee7b7';
  if (percent > 0) return '#d1fae5';
  if (percent === 0) return '#64748b';
  if (percent > -1.5) return '#fee2e2';
  if (percent > -3) return '#fca5a5';
  if (percent > -5) return '#f87171';
  if (percent > -10) return '#ef4444';
  return '#b91c1c';
}

/** Dark text on light-ish tiles (small moves), white elsewhere. */
function textColorFor(percent: number): string {
  if (percent > 0 && percent < 5) return '#0f172a';
  if (percent < 0 && percent > -5) return '#0f172a';
  return '#ffffff';
}

export default function PortfolioHeatmap({ data, isMobile, privacyMode }: PortfolioHeatmapProps) {
  const holdings = data.allHoldings ?? [];

  // Treemap is the canonical default; only override from an explicit saved choice.
  const [view, setView] = useState<ViewMode>('treemap');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored && VIEW_OPTIONS.some(o => o.id === stored)) {
      setView(stored as ViewMode);
    }
  }, []);

  const updateView = (next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures (private mode etc.)
    }
  };

  if (holdings.length === 0) return null;

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 h-[500px] flex flex-col">
      <div className="px-5 pt-4 pb-2 shrink-0 flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Portfolio Heatmap</h3>
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-800/70 border border-white/5 p-0.5">
          {VIEW_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => updateView(opt.id)}
              aria-pressed={view === opt.id}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors ${
                view === opt.id
                  ? 'bg-slate-600/80 text-white shadow'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-slate-700/40'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 w-full min-h-0" style={{ color: '#000' }}>
        {view === 'treemap' && <TreemapView holdings={holdings} isMobile={isMobile} privacyMode={privacyMode} />}
        {view === 'allocation' && <AllocationView holdings={holdings} isMobile={isMobile} privacyMode={privacyMode} />}
        {view === 'bars' && <BarsView holdings={holdings} privacyMode={privacyMode} />}
      </div>
    </div>
  );
}

function TreemapView({ holdings, isMobile, privacyMode }: { holdings: Holding[]; isMobile: boolean; privacyMode: boolean }) {
  return (
    <ResponsiveTreeMap
      data={{
        name: 'Portfolio',
        color: 'transparent',
        children: holdings.map(h => ({ ...h, name: h.symbol, value: h.currentValue })),
      }}
      identity="name"
      value="currentValue"
      valueFormat={val => formatNumber(val, 0, 0)}
      margin={{ top: 0, right: 10, bottom: 10, left: 10 }}
      labelSkipSize={30}
      innerPadding={3}
      outerPadding={3}
      colors={node => colorFor((node.data as { dayChangePercent?: number }).dayChangePercent)}
      nodeOpacity={1}
      nodeComponent={({ node }) => {
        const percent = (node.data as { dayChangePercent?: number }).dayChangePercent;
        if (percent === undefined) return null;

        const textColor = textColorFor(percent);
        const showSymbol = node.width > 28 && node.height > 22;
        const showPercent = node.width > 40 && node.height > 38;
        const maxFs = isMobile ? 8 : 11;
        const fontSize = Math.min(node.width / 5, node.height / (showPercent ? 4.5 : 2.8), maxFs);
        const clipId = `hm-${node.id.replace(/[^a-z0-9]/gi, '_')}`;
        const pad = 3;
        return (
          <motion.g
            key={node.id}
            initial={{ opacity: 0, scale: 0.9, x: node.x, y: node.y }}
            animate={{ opacity: 1, scale: 1, x: node.x, y: node.y }}
            transition={{
              type: 'spring',
              damping: 20,
              stiffness: 300,
              delay: (node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 20) / 100,
            }}
            style={{ cursor: 'pointer' }}
            onMouseEnter={node.onMouseEnter}
            onMouseMove={node.onMouseMove}
            onMouseLeave={node.onMouseLeave}
            onClick={node.onClick}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={pad} y={pad} width={Math.max(0, node.width - pad * 2)} height={Math.max(0, node.height - pad * 2)} />
              </clipPath>
            </defs>
            <rect width={node.width} height={node.height} fill={node.color} stroke="#0f172a" strokeWidth={2} rx={3} ry={3} />
            {showSymbol && (
              <text
                x={node.width / 2}
                y={node.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                clipPath={`url(#${clipId})`}
                style={{ pointerEvents: 'none' }}
              >
                <tspan
                  x={node.width / 2}
                  dy={showPercent ? '-0.6em' : '0.3em'}
                  fontSize={fontSize}
                  fontWeight="700"
                  fill={textColor}
                  style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}
                >
                  {node.id}
                </tspan>
                {showPercent && typeof percent === 'number' && (
                  <tspan
                    x={node.width / 2}
                    dy="1.4em"
                    fontSize={fontSize}
                    fontWeight="600"
                    fill={textColor}
                    fillOpacity={textColor === '#ffffff' ? 0.9 : 0.8}
                    style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}
                  >
                    {percent > 0 ? '+' : ''}
                    {percent.toFixed(1)}%
                  </tspan>
                )}
              </text>
            )}
          </motion.g>
        );
      }}
      enableLabel={false}
      theme={{ tooltip: { container: { background: 'transparent', color: '#fff', padding: 0, borderRadius: '8px', boxShadow: 'none' } } }}
      tooltip={({ node }) => {
        const d = node.data as unknown as Holding;
        return <TileTooltip d={d} privacyMode={privacyMode} />;
      }}
    />
  );
}

/** Donut allocation: slice size = portfolio weight, color = day change. */
type AllocDatum = {
  id: string;
  label: string;
  value: number;
  color: string;
  dayChangePercent: number;
  sector?: string;
  marketCapCategory?: string;
  formattedValue: string;
  weight: number;
};

function AllocationView({ holdings, isMobile, privacyMode }: { holdings: Holding[]; isMobile: boolean; privacyMode: boolean }) {
  const total = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue);
  const [activeId, setActiveId] = useState<string | null>(null);
  const legendRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Keep the active holding visible in the legend — auto-scroll it into view
  // when hovering a slice whose row is currently scrolled out of sight.
  useEffect(() => {
    if (!activeId) return;
    const el = legendRefs.current.get(activeId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  // Show every holding as its own slice (largest first).
  const pieData: AllocDatum[] = sorted.map(h => ({
    id: h.symbol,
    label: h.symbol,
    value: h.currentValue,
    color: colorFor(h.dayChangePercent),
    dayChangePercent: h.dayChangePercent,
    sector: h.sector,
    marketCapCategory: h.marketCapCategory,
    formattedValue: h.formattedValue,
    weight: total > 0 ? (h.currentValue / total) * 100 : 0,
  }));

  const active = pieData.find(d => d.id === activeId) ?? null;

  // Center label rendered as SVG text anchored at the donut's exact geometric
  // center (centerX/centerY). textAnchor="middle" guarantees perfect horizontal
  // centering regardless of legend width or SVG scaling.
  const CenterLayer = ({ centerX, centerY }: { centerX: number; centerY: number }) => {
    const cx = centerX;
    if (active) {
      const changeColor = active.dayChangePercent >= 0 ? '#34d399' : '#f87171';
      const hasSector = Boolean(active.sector);
      const symbolY = hasSector ? centerY - 30 : centerY - 24;
      return (
        <g key={active.id} style={{ pointerEvents: 'none' }} className="alloc-center-fade">
          <text x={cx} y={symbolY} textAnchor="middle" fill="#ffffff" fontSize={14} fontWeight={700} letterSpacing={0.5}>
            {active.label}
          </text>
          {hasSector && (
            <text x={cx} y={centerY - 16} textAnchor="middle" fill="#fbbf24" fontSize={9} fontWeight={500}>
              {active.sector}
            </text>
          )}
          <text x={cx} y={centerY + 8} textAnchor="middle" fill="#ffffff" fontSize={26} fontWeight={800}>
            {active.weight.toFixed(1)}%
          </text>
          <text x={cx} y={centerY + 26} textAnchor="middle" fill={changeColor} fontSize={12} fontWeight={600}>
            {active.dayChangePercent >= 0 ? '+' : ''}
            {active.dayChangePercent.toFixed(2)}%
          </text>
          {!privacyMode && (
            <text x={cx} y={centerY + 42} textAnchor="middle" fill="#9ca3af" fontSize={10} fontFamily="monospace">
              ₹{active.formattedValue}
            </text>
          )}
        </g>
      );
    }
    return (
      <g key="__summary" style={{ pointerEvents: 'none' }} className="alloc-center-fade">
        <text x={cx} y={centerY - 6} textAnchor="middle" fill="#ffffff" fontSize={32} fontWeight={800}>
          {holdings.length}
        </text>
        <text x={cx} y={centerY + 14} textAnchor="middle" fill="#9ca3af" fontSize={10} fontWeight={600} letterSpacing={3}>
          HOLDINGS
        </text>
        {!privacyMode && (
          <text x={cx} y={centerY + 34} textAnchor="middle" fill="#d1d5db" fontSize={12} fontFamily="monospace">
            ₹{formatNumber(total, 0, 0)}
          </text>
        )}
      </g>
    );
  };

  return (
    <motion.div
      className="flex h-full w-full items-stretch gap-2 px-2 pb-2"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
    >
      {/* Donut */}
      <div className="relative flex-1 min-w-0">
        <ResponsivePie
          data={pieData}
          margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
          innerRadius={0.66}
          padAngle={0.7}
          cornerRadius={3}
          activeId={activeId}
          onActiveIdChange={(id) => setActiveId(id as string | null)}
          activeInnerRadiusOffset={7}
          activeOuterRadiusOffset={16}
          colors={{ datum: 'data.color' }}
          borderWidth={1.5}
          borderColor={{ from: 'color', modifiers: [['darker', 0.6]] }}
          enableArcLabels={false}
          enableArcLinkLabels={false}
          animate
          motionConfig="gentle"
          transitionMode="pushIn"
          isInteractive
          onMouseEnter={(datum) => setActiveId(datum.id as string)}
          onMouseLeave={() => setActiveId(null)}
          theme={{
            text: { fontSize: isMobile ? 8 : 10 },
            tooltip: { container: { background: 'transparent', padding: 0, boxShadow: 'none' } },
          }}
          tooltip={() => null}
          layers={['arcs', CenterLayer]}
        />
      </div>

      {/* Legend — every holding, scrollable */}
      {!isMobile && (
        <div className="w-[190px] shrink-0 overflow-y-auto custom-scrollbar pr-1">
          <div className="flex flex-col gap-0.5">
            {pieData.map((d, i) => {
              const isActive = d.id === activeId;
              return (
                <motion.button
                  key={d.id}
                  type="button"
                  ref={(el: HTMLButtonElement | null) => {
                    if (el) legendRefs.current.set(d.id, el);
                    else legendRefs.current.delete(d.id);
                  }}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.012, 0.4) }}
                  onMouseEnter={() => setActiveId(d.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                    isActive ? 'bg-slate-700/60' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-black/30 transition-transform group-hover:scale-125"
                    style={{ background: d.color }}
                  />
                  <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-gray-200">{d.label}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-gray-400 tabular-nums">{d.weight.toFixed(1)}%</span>
                  <span
                    className={`shrink-0 w-11 text-right text-[10px] font-semibold tabular-nums ${
                      d.dayChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {d.dayChangePercent >= 0 ? '+' : ''}
                    {d.dayChangePercent.toFixed(1)}%
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Diverging day-change bars: gainers extend right (green), losers left (red). */
function BarsView({ holdings, privacyMode }: { holdings: Holding[]; privacyMode: boolean }) {
  const sorted = [...holdings].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
  const maxAbs = Math.max(...sorted.map(h => Math.abs(h.dayChangePercent)), 0.01);

  return (
    <div className="h-full overflow-y-auto px-4 pb-3 custom-scrollbar">
      <div className="flex flex-col gap-1">
        {sorted.map(h => {
          const pct = h.dayChangePercent;
          const isPositive = pct >= 0;
          const width = (Math.abs(pct) / maxAbs) * 48; // % of half-track (leave headroom)
          const barColor = isPositive ? '#10b981' : '#ef4444';
          return (
            <div key={h.symbol} className="group flex items-center gap-2 h-6">
              <span className="w-20 shrink-0 text-[11px] font-semibold text-gray-200 truncate">{h.symbol}</span>

              <div className="relative flex-1 h-4">
                {/* center axis */}
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
                {/* diverging bar */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3 rounded-sm transition-[width]"
                  style={{
                    background: barColor,
                    width: `${width}%`,
                    ...(isPositive ? { left: '50%' } : { right: '50%' }),
                  }}
                />
              </div>

              <span
                className={`w-16 shrink-0 text-right text-[11px] font-bold tabular-nums ${
                  isPositive ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {isPositive ? '+' : ''}
                {pct.toFixed(2)}%
              </span>
              <span className="w-14 shrink-0 text-right text-[10px] font-mono text-gray-500 hidden sm:inline">
                {privacyMode ? '****' : `₹${h.formattedValue}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TileTooltip({ d, privacyMode }: { d: Holding; privacyMode: boolean }) {
  const isPositive = d.dayChangePercent >= 0;
  const getCapColor = (cap: string | undefined) => {
    const c = (cap || '').toLowerCase();
    if (c.includes('large')) return 'bg-cyan-500/20 text-cyan-400';
    if (c.includes('mid')) return 'bg-violet-500/20 text-violet-400';
    if (c.includes('small')) return 'bg-fuchsia-500/20 text-fuchsia-400';
    if (c.includes('micro')) return 'bg-lime-500/20 text-lime-400';
    return 'bg-slate-700/50 text-gray-400';
  };
  return (
    <div className="backdrop-blur-md bg-slate-900/90 border border-white/10 p-3 rounded-xl shadow-2xl min-w-[160px]">
      <div className="flex items-center justify-between gap-4 mb-2">
        <span className="font-bold text-white text-sm tracking-wide">{d.symbol}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCapColor(d.marketCapCategory)}`}>
          {d.marketCapCategory || 'Stock'}
        </span>
      </div>
      {d.sector && <div className="text-[10px] text-amber-400 mb-1.5">{d.sector}</div>}
      <div className="flex items-baseline gap-1 mt-1">
        <span className={`text-lg font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}
          {d.dayChangePercent?.toFixed(2)}%
        </span>
      </div>
      <div className="mt-2 pt-2 border-t border-white/5 flex flex-col gap-0.5">
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Value</span>
          <span className="text-gray-200 font-mono">{privacyMode ? '****' : `₹${d.formattedValue}`}</span>
        </div>
      </div>
    </div>
  );
}
