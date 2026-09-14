'use client';

import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar } from '@fortawesome/free-solid-svg-icons';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import type { ExitRecord } from '@/lib/exits';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeReturnHistogramProps {
  exits: ExitRecord[];
}

type ReturnMode = 'gross' | 'net';

interface Bucket {
  label: string;
  min: number;
  max: number;
  color: string;
}

interface ChartDataPoint {
  label: string;
  count: number;
  color: string;
  isWin: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const BUCKETS: Bucket[] = [
  { label: '< -20%',      min: -Infinity,  max: -20,    color: '#dc2626' },  // red-600
  { label: '-20 to -10%', min: -20,        max: -10,    color: '#ef4444' },  // red-500
  { label: '-10 to -5%',  min: -10,        max: -5,     color: '#f87171' },  // red-400
  { label: '-5 to 0%',    min: -5,         max: 0,      color: '#fca5a5' },  // red-300
  { label: '0 to +10%',   min: 0,          max: 10,     color: '#6ee7b7' },  // emerald-300
  { label: '+10 to +25%', min: 10,         max: 25,     color: '#34d399' },  // emerald-400
  { label: '+25 to +50%', min: 25,         max: 50,     color: '#10b981' },  // emerald-500
  { label: '> +50%',      min: 50,         max: Infinity, color: '#059669' }, // emerald-600
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getReturnPercent(exit: ExitRecord, mode: ReturnMode): number {
  if (mode === 'net' && exit.netGainLoss !== undefined && exit.netGainLoss !== null) {
    const costBasis = exit.buyPrice * exit.quantity;
    return costBasis > 0 ? (exit.netGainLoss / costBasis) * 100 : 0;
  }
  return exit.changePercent;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartDataPoint }[];
}) => {
  if (!active || !payload?.length) return null;
  const { label, count, isWin } = payload[0].payload;
  return (
    <div className="bg-[#0c1220]/98 border border-white/10 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md min-w-[140px]">
      <p className="text-xs text-gray-400 mb-1.5 font-medium">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
        {count} trade{count !== 1 ? 's' : ''}
      </p>
    </div>
  );
};

// ─── Stat Chip ────────────────────────────────────────────────────────────────

const StatChip = ({
  label,
  value,
  color = 'text-gray-100',
}: {
  label: string;
  value: string;
  color?: string;
}) => (
  <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex flex-col min-w-[90px]">
    <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">{label}</span>
    <span className={`text-sm font-bold tabular-nums leading-snug ${color}`}>{value}</span>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TradeReturnHistogram({ exits }: TradeReturnHistogramProps) {
  const [mode, setMode] = useState<ReturnMode>('gross');

  const { chartData, stats, medianWin, medianLoss } = useMemo(() => {
    if (!exits || exits.length === 0) {
      return {
        chartData: BUCKETS.map(b => ({ label: b.label, count: 0, color: b.color, isWin: b.min >= 0 })),
        stats: { total: 0, wins: 0, winRate: 0, avgWin: 0, avgLoss: 0, expectancy: 0 },
        medianWin: 0,
        medianLoss: 0,
      };
    }

    const returns = exits.map(e => getReturnPercent(e, mode));

    // Bucket counts
    const bucketCounts = BUCKETS.map(b => ({
      label: b.label,
      count: returns.filter(r => r >= b.min && r < b.max).length,
      color: b.color,
      isWin: b.min >= 0,
    }));

    // Stats
    const wins = returns.filter(r => r >= 0);
    const losses = returns.filter(r => r < 0);
    const total = returns.length;
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, v) => s + v, 0) / losses.length : 0;
    // Expectancy = winRate × avgWin + lossRate × avgLoss
    const expectancy = (winRate / 100) * avgWin + ((100 - winRate) / 100) * avgLoss;

    return {
      chartData: bucketCounts,
      stats: { total, wins: wins.length, winRate, avgWin, avgLoss, expectancy },
      medianWin: median(wins),
      medianLoss: median(losses),
    };
  }, [exits, mode]);

  const maxCount = Math.max(...chartData.map(d => d.count), 1);

  if (!exits || exits.length === 0) {
    return (
      <div className="h-[360px] flex flex-col items-center justify-center text-gray-500 gap-3">
        <FontAwesomeIcon icon={faChartBar} className="text-4xl text-gray-700" />
        <p className="text-sm">No exits to display</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-rose-500/20 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faChartBar} className="text-emerald-400 text-lg" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-200 leading-tight">Return Distribution</h3>
            <p className="text-[11px] text-gray-500">Frequency of realized trade returns</p>
          </div>
        </div>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => v && setMode(v as ReturnMode)}
          size="small"
          sx={{ '& .MuiToggleButton-root': { color: '#9ca3af', borderColor: 'rgba(255,255,255,0.1)', fontSize: '11px', padding: '3px 10px', textTransform: 'none', '&.Mui-selected': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' } } }}
        >
          <ToggleButton value="gross">Gross %</ToggleButton>
          <ToggleButton value="net">Net %</ToggleButton>
        </ToggleButtonGroup>
      </div>

      {/* Stat chips */}
      <div className="flex flex-wrap gap-2">
        <StatChip label="Total Exits" value={String(stats.total)} />
        <StatChip
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          color={stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatChip
          label="Avg Winner"
          value={`+${stats.avgWin.toFixed(1)}%`}
          color="text-emerald-400"
        />
        <StatChip
          label="Avg Loser"
          value={`${stats.avgLoss.toFixed(1)}%`}
          color="text-rose-400"
        />
        <StatChip
          label="Median Win"
          value={`+${medianWin.toFixed(1)}%`}
          color="text-emerald-400"
        />
        <StatChip
          label="Median Loss"
          value={`${medianLoss.toFixed(1)}%`}
          color="text-rose-400"
        />
        <StatChip
          label="Expectancy"
          value={`${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(1)}%`}
          color={stats.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
      </div>

      {/* Skewness insight */}
      {stats.total >= 5 && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${stats.avgWin > Math.abs(stats.avgLoss)
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
        }`}>
          {stats.avgWin > Math.abs(stats.avgLoss)
            ? `✓ Positive skew — avg winner (${stats.avgWin.toFixed(1)}%) larger than avg loser (${Math.abs(stats.avgLoss).toFixed(1)}%). Classic momentum profile.`
            : `⚠ Negative skew — avg loser (${Math.abs(stats.avgLoss).toFixed(1)}%) exceeds avg winner (${stats.avgWin.toFixed(1)}%). Review stop-loss discipline.`
          }
        </div>
      )}

      {/* Chart */}
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 480 }}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 4 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => String(v)}
                domain={[0, maxCount + 1]}
                label={{ value: 'Trades', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#6b7280', fontSize: 10 } }}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              {/* Zero / win-loss divider */}
              <ReferenceLine x="-5 to 0%" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
              {/* Median reference lines */}
              {medianWin !== 0 && (
                <ReferenceLine
                  x={chartData.find(d => {
                    const b = BUCKETS.find(b2 => medianWin >= b2.min && medianWin < b2.max);
                    return b && d.label === b.label;
                  })?.label}
                  stroke="#34d399"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  label={{ value: 'Median Win', position: 'top', fill: '#34d399', fontSize: 10 }}
                />
              )}
              {medianLoss !== 0 && (
                <ReferenceLine
                  x={chartData.find(d => {
                    const b = BUCKETS.find(b2 => medianLoss >= b2.min && medianLoss < b2.max);
                    return b && d.label === b.label;
                  })?.label}
                  stroke="#f87171"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  label={{ value: 'Median Loss', position: 'top', fill: '#f87171', fontSize: 10 }}
                />
              )}
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
