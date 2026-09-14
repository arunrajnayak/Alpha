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
  dailyReturn: number | null | undefined;
};

type Window = '90D' | '180D' | '1Y' | '2Y';

interface RollingPoint {
  dateStr: string;
  sharpe: number | null;
  sortino: number | null;
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

const SHARPE_COLOR  = '#3b82f6'; // blue-500
const SORTINO_COLOR = '#10b981'; // emerald-500

// ─── Computation ──────────────────────────────────────────────────────────────

function computeRollingRisk(data: DataPoint[], windowDays: number): RollingPoint[] {
  const result: RollingPoint[] = [];

  for (let i = windowDays; i < data.length; i++) {
    const window = data.slice(i - windowDays, i);
    const returns = window
      .map(d => d.dailyReturn ?? null)
      .filter((r): r is number => r !== null);

    if (returns.length < windowDays * 0.6) {
      // Less than 60% of window has data — skip (avoids spurious values early in history)
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

    const curr = data[i];
    const dateStr = format(new Date(curr.date), 'yyyy-MM-dd');

    result.push({
      dateStr,
      sharpe:  sharpe  !== null ? Math.max(-5, Math.min(5, sharpe))  : null,
      sortino: sortino !== null ? Math.max(-5, Math.min(5, sortino)) : null,
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
    <div className="bg-[#0c1220]/98 border border-white/10 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md min-w-[160px]">
      <p className="text-[11px] text-gray-400 mb-2 font-medium">
        {label ? format(parseISO(label), 'd MMM yyyy') : ''}
      </p>
      {payload.map((entry) =>
        entry.value !== null ? (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-xs mb-0.5">
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
  <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex flex-col min-w-[90px]">
    <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">{label}</span>
    <span className={`text-sm font-bold tabular-nums leading-snug ${color}`}>{value}</span>
    {sub && <span className="text-[10px] text-gray-500 leading-tight">{sub}</span>}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RollingRiskChart({ data }: { data: DataPoint[] }) {
  const [window, setWindow] = useState<Window>('180D');

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
  const currentSharpe  = latest?.sharpe  ?? null;
  const currentSortino = latest?.sortino ?? null;

  // Days in positive Sharpe territory
  const positiveSharpe = useMemo(
    () => chartData.filter(d => d.sharpe !== null && d.sharpe > 0).length,
    [chartData]
  );
  const positivePct = chartData.length > 0 ? ((positiveSharpe / chartData.length) * 100).toFixed(0) : '—';

  if (data.length === 0) {
    return (
      <div className="h-[340px] flex items-center justify-center text-gray-500 text-sm">
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
          <div>
            <h3 className="text-sm font-bold text-gray-200 leading-tight">Rolling Sharpe &amp; Sortino</h3>
            <p className="text-[11px] text-gray-500">Risk-adjusted performance over time</p>
          </div>
        </div>
        <div className="h-[200px] flex items-center justify-center text-gray-500 text-sm">
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
  const allValues = chartData.flatMap(d => [d.sharpe, d.sortino]).filter((v): v is number => v !== null);
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : -2;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 3;
  const yMin = Math.floor(rawMin - 0.3);
  const yMax = Math.ceil(rawMax + 0.3);

  // Month ticks
  const monthTicks = (() => {
    const seen = new Set<string>();
    return chartData.reduce<string[]>((acc, d) => {
      const key = d.dateStr.slice(0, 7);
      if (!seen.has(key)) { seen.add(key); acc.push(d.dateStr); }
      return acc;
    }, []);
  })();

  // Show every Nth tick based on data length to avoid crowding
  const tickInterval = Math.max(1, Math.floor(monthTicks.length / 10));
  const visibleTicks = monthTicks.filter((_, i) => i % tickInterval === 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faShieldHalved} className="text-blue-400 text-lg" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-200 leading-tight">Rolling Sharpe &amp; Sortino</h3>
            <p className="text-[11px] text-gray-500">Risk-adjusted performance · annualised · MAR = 0%</p>
          </div>
        </div>
        {availableWindows.length > 1 && (
          <ToggleButtonGroup
            value={window}
            exclusive
            onChange={(_, v) => v && setWindow(v as Window)}
            size="small"
            sx={{ '& .MuiToggleButton-root': { color: '#9ca3af', borderColor: 'rgba(255,255,255,0.1)', fontSize: '11px', padding: '3px 10px', textTransform: 'none', '&.Mui-selected': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' } } }}
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
        <StatChip
          label="Positive Sharpe"
          value={`${positivePct}% of days`}
          color={Number(positivePct) >= 60 ? 'text-emerald-400' : 'text-yellow-400'}
        />
      </div>

      {/* Chart */}
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 480 }}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              {/* Background band: Sharpe 1–2 (good) */}
              <ReferenceArea y1={1} y2={2} fill="#10b981" fillOpacity={0.05} />
              {/* Background band: Sharpe > 2 (excellent) */}
              <ReferenceArea y1={2} y2={yMax} fill="#10b981" fillOpacity={0.08} />

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
                strokeOpacity={0.5}
                strokeWidth={1}
                label={{ value: 'Good (1)', position: 'right', fill: '#10b981', fontSize: 9 }}
              />
              {/* "Excellent" threshold */}
              <ReferenceLine
                y={2}
                stroke="#10b981"
                strokeDasharray="5 4"
                strokeOpacity={0.6}
                strokeWidth={1}
                label={{ value: 'Excellent (2)', position: 'right', fill: '#10b981', fontSize: 9 }}
              />

              <Line
                type="monotone"
                dataKey="sharpe"
                stroke={SHARPE_COLOR}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                name="Sharpe"
              />
              <Line
                type="monotone"
                dataKey="sortino"
                stroke={SORTINO_COLOR}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                name="Sortino"
                strokeDasharray="5 3"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 h-0.5 rounded" style={{ backgroundColor: SHARPE_COLOR }} />
          Sharpe (volatility-adjusted)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 border-t border-dashed" style={{ borderColor: SORTINO_COLOR }} />
          Sortino (downside-only)
        </span>
      </div>
    </div>
  );
}
