'use client';

import React, { useState, useEffect, useTransition } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { fetchMarketHealthHistory } from '@/app/actions/market-breadth';
import type { MarketHealthHistoryData } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartPulse, faShieldHalved } from '@fortawesome/free-solid-svg-icons';

interface MarketHealthDashboardProps {
  initialData?: MarketHealthHistoryData | null;
}

type TimeframePeriod = '6M' | '1Y' | 'ALL';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// DMA series config — order matches TradingView chart colors
const DMA_SERIES = [
  { key: 'pctAbove20Dma',  label: '% Above 20 DMA',  color: '#f23645' }, // Red
  { key: 'pctAbove50Dma',  label: '% Above 50 DMA',  color: '#4caf50' }, // Green
  { key: 'pctAbove100Dma', label: '% Above 100 DMA', color: '#0497a7' }, // Teal
  { key: 'pctAbove200Dma', label: '% Above 200 DMA', color: '#ff9800' }, // Orange
] as const;

function formatXAxisDate(val: string): string {
  if (!val) return '';
  const parts = val.split('-');
  if (parts.length >= 3) {
    const month = MONTH_NAMES[parseInt(parts[1], 10) - 1] || parts[1];
    const year = parts[0].slice(-2);
    return `${month} '${year}`;
  }
  return val;
}

function formatTooltipDate(val: unknown): string {
  if (typeof val !== 'string') return '';
  const parts = val.split('-');
  if (parts.length >= 3) {
    const month = MONTH_NAMES[parseInt(parts[1], 10) - 1] || parts[1];
    return `${parts[2]} ${month} ${parts[0]}`;
  }
  return val;
}

export default function MarketHealthDashboard({ initialData }: MarketHealthDashboardProps) {
  const [data, setData] = useState<MarketHealthHistoryData | null>(initialData || null);
  const [period, setPeriod] = useState<TimeframePeriod>('1Y');
  const [loading, setLoading] = useState(!initialData);
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);
  const isFirstMount = React.useRef(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData) return;
    }

    startTransition(() => {
      setLoading(true);
      fetchMarketHealthHistory(period)
        .then((res) => {
          setData(res);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, [period, initialData]);

  const stats = data?.currentStats;

  const regimeBadgeColor =
    stats?.regime === 'Strong Bullish'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : stats?.regime === 'Bullish'
      ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
      : stats?.regime === 'Neutral'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

  return (
    <div className="flex flex-col gap-5 bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-6 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <FontAwesomeIcon icon={faHeartPulse} className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base md:text-lg font-bold text-white tracking-tight">
                Market Health &amp; Breadth
              </h2>
              {stats && (
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${regimeBadgeColor}`}
                >
                  {stats.regime}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Timeframe Toggles */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-white/5 self-start sm:self-auto">
          {(['6M', '1Y', 'ALL'] as TimeframePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                period === p
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* Above 200 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 200 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono" style={{ color: '#ff9800' }}>
              {stats ? `${stats.pctAbove200Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Long-term</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Regime: {stats?.pctAbove200Dma && stats.pctAbove200Dma >= 50 ? 'Bull' : 'Bear'} filter</span>
        </div>

        {/* Above 100 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 100 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono" style={{ color: '#0497a7' }}>
              {stats ? `${stats.pctAbove100Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Intermediate</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Medium-term trend</span>
        </div>

        {/* Above 50 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 50 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono" style={{ color: '#4caf50' }}>
              {stats ? `${stats.pctAbove50Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Swing trend</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Swing trend participation</span>
        </div>

        {/* Above 20 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 20 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono" style={{ color: '#f23645' }}>
              {stats ? `${stats.pctAbove20Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Short-term</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Momentum thrust</span>
        </div>
      </div>

      {/* Chart: Moving Average Breadth Over Time */}
      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faShieldHalved} className="w-3.5 h-3.5 text-purple-400" />
            <h3 className="text-sm md:text-base font-semibold text-gray-200">
              Moving Average Breadth (% of Stocks Above DMA)
            </h3>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">50% line = Bull/Bear pivot</span>
        </div>

        <div className="h-[260px] sm:h-[340px] md:h-[460px] w-full mt-2">
          {loading && !data ? (
            <div className="h-full bg-slate-800/50 rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.history || []} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  minTickGap={35}
                  tickFormatter={formatXAxisDate}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  unit="%"
                />
                <ReferenceLine y={50} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1220',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
                  labelFormatter={formatTooltipDate}
                  formatter={(val: unknown, name: string) => [`${val ?? 0}%`, name]}
                />
                {DMA_SERIES.map(({ key, label, color }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={label}
                    stroke={color}
                    strokeWidth={hoveredLine === key ? 3 : 1.5}
                    strokeOpacity={hoveredLine && hoveredLine !== key ? 0.12 : 1}
                    dot={false}
                    activeDot={{ r: 4, fill: color, strokeWidth: 1.5, stroke: '#fff' }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Custom Legend with hover interaction */}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-3">
          {DMA_SERIES.map(({ key, label, color }) => {
            const isHovered = hoveredLine === key;
            const isDimmed = hoveredLine !== null && !isHovered;
            return (
              <button
                key={key}
                onMouseEnter={() => setHoveredLine(key)}
                onMouseLeave={() => setHoveredLine(null)}
                className={`flex items-center gap-2 py-1 transition-all duration-200 cursor-default ${
                  isHovered
                    ? 'scale-105 opacity-100'
                    : isDimmed
                    ? 'opacity-30'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <span
                  className="w-6 h-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[11px] font-medium tracking-wide text-gray-300">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
