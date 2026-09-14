'use client';

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { DistributionBucket } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartSimple } from '@fortawesome/free-solid-svg-icons';

interface StockMovesDistributionChartProps {
  distribution: DistributionBucket[];
  medianMove: number;
  totalStocks: number;
  loading?: boolean;
}

const BUCKET_COLORS: Record<string, string> = {
  '< -15%': '#7f1d1d', // red-900
  '-15% to -10%': '#991b1b', // red-800
  '-10% to -5%': '#b91c1c', // red-700
  '-5% to -3%': '#dc2626', // red-600
  '-3% to -1%': '#ef4444', // red-500
  '-1% to 0%': '#f87171', // red-400
  '0%': '#94a3b8', // slate-400
  '0% to +1%': '#86efac', // green-300
  '+1% to +3%': '#4ade80', // green-400
  '+3% to +5%': '#22c55e', // green-500
  '+5% to +10%': '#16a34a', // green-600
  '+10% to +15%': '#15803d', // green-700
  '> +15%': '#14532d', // green-900
};

const SHORT_LABELS: Record<string, string> = {
  '< -15%': '<-15%',
  '-15% to -10%': '-15:-10',
  '-10% to -5%': '-10:-5',
  '-5% to -3%': '-5:-3',
  '-3% to -1%': '-3:-1',
  '-1% to 0%': '-1:0',
  '0%': '0%',
  '0% to +1%': '0:+1',
  '+1% to +3%': '+1:+3',
  '+3% to +5%': '+3:+5',
  '+5% to +10%': '+5:+10',
  '+10% to +15%': '+10:+15',
  '> +15%': '>+15%',
};

interface TooltipPayloadItem {
  payload: {
    label: string;
    count: number;
    percent: number;
    color: string;
  };
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const isPositive = data.label.includes('+') || data.label.startsWith('>');
  const isZero = data.label === '0%';

  return (
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[130px]">
      <span className="text-[11px] text-gray-400 font-medium block mb-1">
        Change: <span className="text-gray-200 font-semibold">{data.label}</span>
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-lg font-bold font-mono ${
            isZero ? 'text-gray-300' : isPositive ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {data.count}
        </span>
        <span className="text-xs text-gray-400 font-mono">
          ({data.percent}%)
        </span>
      </div>
    </div>
  );
};

export default function StockMovesDistributionChart({
  distribution,
  medianMove,
  totalStocks,
  loading = false,
}: StockMovesDistributionChartProps) {
  const chartData = useMemo(() => {
    return distribution.map((b) => ({
      label: b.label,
      count: b.count,
      percent: b.percent,
      color: BUCKET_COLORS[b.label] || '#38bdf8',
    }));
  }, [distribution]);

  if (loading && distribution.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 md:p-5 h-[230px] animate-pulse" />
    );
  }

  // Summary counts
  const positiveCount = distribution
    .filter((b) => b.label.includes('+') || b.label.startsWith('>'))
    .reduce((acc, curr) => acc + curr.count, 0);

  const negativeCount = distribution
    .filter((b) => b.label.includes('-') || b.label.startsWith('<'))
    .reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-5 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FontAwesomeIcon icon={faChartSimple} className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-white tracking-tight">
                Stock Moves Distribution
              </h3>
              <p className="text-[11px] text-gray-400">Day price change spread</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="text-right">
              <span className="text-[10px] uppercase text-gray-500 block font-sans">
                Median Move
              </span>
              <span
                className={`font-bold ${
                  medianMove > 0
                    ? 'text-emerald-400'
                    : medianMove < 0
                    ? 'text-rose-400'
                    : 'text-gray-300'
                }`}
              >
                {medianMove > 0 ? `+${medianMove}%` : `${medianMove}%`}
              </span>
            </div>
          </div>
        </div>

        {/* Histogram Chart */}
        <div className="h-[140px] w-full mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 4, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tick={{ fill: '#94a3b8', fontSize: 9 }}
                tickFormatter={(v) => SHORT_LABELS[v] || v}
                interval={0}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 9 }}
                allowDecimals={false}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Distribution Footer Insight */}
      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-white/5 text-gray-400 font-mono">
        <span className="text-rose-400">
          {negativeCount} ({totalStocks > 0 ? ((negativeCount / totalStocks) * 100).toFixed(0) : 0}%) negative
        </span>
        <span className="text-gray-500 font-sans text-[10px]">
          {negativeCount > positiveCount ? 'Sell-side Skew' : 'Buy-side Skew'}
        </span>
        <span className="text-emerald-400">
          {positiveCount} ({totalStocks > 0 ? ((positiveCount / totalStocks) * 100).toFixed(0) : 0}%) positive
        </span>
      </div>
    </div>
  );
}
