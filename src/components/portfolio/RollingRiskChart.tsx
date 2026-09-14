'use client';

import React, { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

// ─── Types ────────────────────────────────────────────────────────────────────

type DataPoint = {
  date: Date | string;
  dailyReturn?: number | null;
  portfolioNAV?: number | null;
  niftyNAV?: number | null;
  [key: string]: unknown;
};

type Window = '90D' | '180D' | '1Y' | '2Y';

interface RollingPoint {
  dateStr: string;
  sharpe: number | null;
  sortino: number | null;
  niftySharpe: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approximate trading days for each window */
const WINDOW_DAYS: Record<Window, number> = {
  '90D':  63,
  '180D': 126,
  '1Y':   252,
  '2Y':   504,
};

const ALL_WINDOWS: Window[] = ['90D', '180D', '1Y', '2Y'];
const ANNUALISE = Math.sqrt(252);

const SHARPE_COLOR       = '#3b82f6'; // blue-500
const SORTINO_COLOR      = '#10b981'; // emerald-500
const NIFTY_SHARPE_COLOR = '#8b5cf6'; // violet-500

// ─── Computation ──────────────────────────────────────────────────────────────

function computeRollingRisk(data: DataPoint[], windowDays: number): RollingPoint[] {
  const result: RollingPoint[] = [];

  for (let i = windowDays; i < data.length; i++) {
    const window = data.slice(i - windowDays, i);
    const returns = window
      .map(d => d.dailyReturn ?? null)
      .filter((r): r is number => r !== null);

    if (returns.length < windowDays * 0.6) {
      // Less than 60% of window has data — skip
      continue;
    }

    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;

    // Standard deviation (population)
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);

    // Downside deviation (MAR = 0, standard Sortino)
    const downsideReturns = returns.filter(r => r < 0);
    const downsideVariance =
      downsideReturns.length > 0
        ? downsideReturns.reduce((s, v) => s + v ** 2, 0) / returns.length
        : 0;
    const downsideStd = Math.sqrt(downsideVariance);

    const sharpe  = std > 0 ? (mean / std) * ANNUALISE : null;
    const sortino = downsideStd > 0 ? (mean / downsideStd) * ANNUALISE : null;

    // Nifty daily returns in the same window
    const niftyReturns: number[] = [];
    for (let j = i - windowDays; j < i; j++) {
      const currN = data[j]?.niftyNAV;
      const prevN = data[j - 1]?.niftyNAV;
      if (currN != null && prevN != null && prevN > 0) {
        niftyReturns.push((currN / prevN) - 1);
      }
    }

    let niftySharpe: number | null = null;
    if (niftyReturns.length >= windowDays * 0.5) {
      const nMean = niftyReturns.reduce((s, v) => s + v, 0) / niftyReturns.length;
      const nVar = niftyReturns.reduce((s, v) => s + (v - nMean) ** 2, 0) / niftyReturns.length;
      const nStd = Math.sqrt(nVar);
      niftySharpe = nStd > 0 ? (nMean / nStd) * ANNUALISE : null;
    }

    const curr = data[i];
    const dateStr = format(new Date(curr.date), 'yyyy-MM-dd');

    result.push({
      dateStr,
      sharpe:      sharpe      !== null ? Math.max(-5, Math.min(5, sharpe))      : null,
      sortino:     sortino     !== null ? Math.max(-5, Math.min(5, sortino))     : null,
      niftySharpe: niftySharpe !== null ? Math.max(-5, Math.min(5, niftySharpe)) : null,
    });
  }

  return result;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0c1220]/98 border border-white/10 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md min-w-[170px]">
      <p className="text-[11px] text-gray-400 mb-2 font-medium">
        {label ? format(parseISO(label), 'd MMM yyyy') : ''}
      </p>
      {payload.map((entry) =>
        entry.value !== null && entry.value !== undefined ? (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-xs mb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-gray-300">{entry.name}</span>
            </span>
            <span
              className="font-bold tabular-nums"
              style={{ color: entry.color }}
            >
              {entry.value >= 0 ? '+' : ''}{entry.value.toFixed(2)}
            </span>
          </div>
        ) : null
      )}
    </div>
  );
};

// ─── Stat Chip ────────────────────────────────────────────────────────────────

const StatChip = ({
  label,
  value,
  color = 'text-gray-100',
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) => (
  <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex flex-col min-w-[95px]">
    <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">{label}</span>
    <span className={`text-sm font-bold tabular-nums leading-snug ${color}`}>{value}</span>
    {sub && <span className="text-[10px] text-gray-500 leading-tight">{sub}</span>}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RollingRiskChart({ data }: { data: DataPoint[] }) {
  const [window, setWindow] = useState<Window>('180D');
  const [visible, setVisible] = useState<Record<string, boolean>>({
    sharpe: true,
    sortino: true,
    niftySharpe: true,
  });

  const validData = useMemo(
    () => data.filter(d => d.dailyReturn !== null && d.dailyReturn !== undefined),
    [data]
  );

  // Only show window options where enough data exists
  const availableWindows = useMemo(
    () => ALL_WINDOWS.filter(w => validData.length > WINDOW_DAYS[w]),
    [validData]
  );

  const chartData = useMemo(
    () => computeRollingRisk(data, WINDOW_DAYS[window]),
    [data, window]
  );

  // Trailing stats (last data point)
  const latest = chartData[chartData.length - 1];
  const currentSharpe      = latest?.sharpe      ?? null;
  const currentSortino     = latest?.sortino     ?? null;
  const currentNiftySharpe = latest?.niftySharpe ?? null;

  const sharpeAlpha =
    currentSharpe != null && currentNiftySharpe != null
      ? currentSharpe - currentNiftySharpe
      : null;

  // Days in positive Sharpe territory
  const positiveSharpe = useMemo(
    () => chartData.filter(d => d.sharpe !== null && d.sharpe > 0).length,
    [chartData]
  );
  const positivePct = chartData.length > 0 ? ((positiveSharpe / chartData.length) * 100).toFixed(0) : '—';

  const toggleSeries = (key: string) => {
    setVisible(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (data.length === 0) {
    return (
      <div className="h-[380px] flex items-center justify-center text-gray-500 text-sm">
        No data to display
      </div>
    );
  }

  if (availableWindows.length === 0 || chartData.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faShieldHalved} className="text-blue-400 text-lg" />
          </div>
          <h3 className="text-sm font-bold text-gray-200 leading-tight">Rolling Sharpe &amp; Sortino</h3>
        </div>
        <div className="h-[240px] flex items-center justify-center text-gray-500 text-sm">
          Need at least {WINDOW_DAYS['90D']} trading days of history to show this chart.
        </div>
      </div>
    );
  }

  const sharpeColor = (v: number | null) => {
    if (v === null) return 'text-gray-400';
    if (v >= 2) return 'text-emerald-400';
    if (v >= 1) return 'text-blue-400';
    if (v >= 0) return 'text-yellow-400';
    return 'text-rose-400';
  };

  // Determine y-domain with some padding
  const allValues = chartData.flatMap(d => [d.sharpe, d.sortino, d.niftySharpe]).filter((v): v is number => v !== null);
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : -2;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 3;
  const yMin = Math.floor(rawMin - 0.3);
  const yMax = Math.ceil(Math.max(rawMax + 0.3, 2.2));

  // Month ticks
  const monthTicks = (() => {
    const seen = new Set<string>();
    return chartData.reduce<string[]>((acc, d) => {
      const key = d.dateStr.slice(0, 7);
      if (!seen.has(key)) { seen.add(key); acc.push(d.dateStr); }
      return acc;
    }, []);
  })();

  const tickInterval = Math.max(1, Math.floor(monthTicks.length / 10));
  const visibleTicks = monthTicks.filter((_, i) => i % tickInterval === 0);

  const seriesButtons = [
    { key: 'sharpe', label: 'Portfolio Sharpe', color: SHARPE_COLOR },
    { key: 'sortino', label: 'Portfolio Sortino', color: SORTINO_COLOR },
    { key: 'niftySharpe', label: 'Nifty 50 Sharpe', color: NIFTY_SHARPE_COLOR },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faShieldHalved} className="text-blue-400 text-lg" />
          </div>
          <h3 className="text-sm font-bold text-gray-200 leading-tight">Rolling Sharpe &amp; Sortino</h3>
        </div>
        {availableWindows.length > 1 && (
          <ToggleButtonGroup
            value={window}
            exclusive
            onChange={(_, v) => v && setWindow(v as Window)}
            size="small"
            sx={{
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
              '& .MuiToggleButton-root': {
                color: '#9ca3af',
                borderColor: 'rgba(255,255,255,0.1)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 10px',
                textTransform: 'none',
                '&.Mui-selected': {
                  color: '#38bdf8',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  borderColor: 'rgba(56, 189, 248, 0.3)',
                },
              },
            }}
          >
            {availableWindows.map(w => (
              <ToggleButton key={w} value={w}>{w}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </div>

      {/* Stat chips */}
      <div className="flex flex-wrap gap-2">
        <StatChip
          label={`Sharpe (${window})`}
          value={currentSharpe !== null ? `${currentSharpe >= 0 ? '+' : ''}${currentSharpe.toFixed(2)}` : '—'}
          color={sharpeColor(currentSharpe)}
          sub="Trailing"
        />
        <StatChip
          label={`Sortino (${window})`}
          value={currentSortino !== null ? `${currentSortino >= 0 ? '+' : ''}${currentSortino.toFixed(2)}` : '—'}
          color={sharpeColor(currentSortino)}
          sub="Trailing"
        />
        {currentNiftySharpe !== null && (
          <StatChip
            label={`Nifty Sharpe (${window})`}
            value={`${currentNiftySharpe >= 0 ? '+' : ''}${currentNiftySharpe.toFixed(2)}`}
            color="text-violet-400"
            sub="Benchmark"
          />
        )}
        {sharpeAlpha !== null && (
          <StatChip
            label="Sharpe Alpha"
            value={`${sharpeAlpha >= 0 ? '+' : ''}${sharpeAlpha.toFixed(2)}`}
            color={sharpeAlpha >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            sub="vs Nifty"
          />
        )}
        <StatChip
          label="Positive Sharpe"
          value={`${positivePct}% of days`}
          color={Number(positivePct) >= 60 ? 'text-emerald-400' : 'text-yellow-400'}
        />
      </div>

      {/* Chart */}
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 480 }}>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
              {/* Background band: Sharpe 1–2 (good) */}
              <ReferenceArea y1={1} y2={2} fill="#10b981" fillOpacity={0.04} />
              {/* Background band: Sharpe > 2 (excellent) */}
              <ReferenceArea y1={2} y2={yMax} fill="#10b981" fillOpacity={0.07} />

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="dateStr"
                ticks={visibleTicks}
                tickFormatter={d => {
                  try { return format(parseISO(d), 'MMM yy'); } catch { return d; }
                }}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickCount={7}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Zero line */}
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
              {/* "Good" threshold */}
              <ReferenceLine
                y={1}
                stroke="#10b981"
                strokeDasharray="5 4"
                strokeOpacity={0.4}
                strokeWidth={1}
                label={{ value: 'Good (1)', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }}
              />
              {/* "Excellent" threshold */}
              <ReferenceLine
                y={2}
                stroke="#10b981"
                strokeDasharray="5 4"
                strokeOpacity={0.5}
                strokeWidth={1}
                label={{ value: 'Excellent (2)', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }}
              />

              {visible.sharpe && (
                <Line
                  type="monotone"
                  dataKey="sharpe"
                  stroke={SHARPE_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: SHARPE_COLOR, strokeWidth: 0 }}
                  connectNulls={false}
                  name="Portfolio Sharpe"
                />
              )}
              {visible.sortino && (
                <Line
                  type="monotone"
                  dataKey="sortino"
                  stroke={SORTINO_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: SORTINO_COLOR, strokeWidth: 0 }}
                  connectNulls={false}
                  name="Portfolio Sortino"
                  strokeDasharray="5 3"
                />
              )}
              {visible.niftySharpe && (
                <Line
                  type="monotone"
                  dataKey="niftySharpe"
                  stroke={NIFTY_SHARPE_COLOR}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4, fill: NIFTY_SHARPE_COLOR, strokeWidth: 0 }}
                  connectNulls={false}
                  name="Nifty 50 Sharpe"
                  strokeDasharray="3 3"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Interactive Legend with toggle buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
        {seriesButtons.map((item) => {
          const isHidden = !visible[item.key];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleSeries(item.key)}
              className={`flex items-center gap-2 py-1 px-2 rounded-md transition-all duration-200 cursor-pointer ${
                isHidden ? 'opacity-40 grayscale bg-white/5' : 'opacity-85 hover:opacity-100 bg-white/5'
              }`}
            >
              <span
                className="w-4 h-1 rounded-full shadow-sm"
                style={{ backgroundColor: item.color }}
              />
              <span
                className={`text-[11px] font-medium tracking-wide ${
                  isHidden ? 'text-gray-500 line-through' : 'text-gray-300'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
