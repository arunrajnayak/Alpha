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
  LabelList,
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
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[140px]">
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
          stocks ({data.percent}%)
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
      color: BUCKET_COLORS[b.label] || '#94a3b8',
    }));
  }, [distribution]);

  if (loading && distribution.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 md:p-6 h-[310px] sm:h-[390px] md:h-[470px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FontAwesomeIcon icon={faChartSimple} className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="font-semibold text-base md:text-lg text-white tracking-tight">
                Stock Moves Distribution
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="text-right">
              <span className="text-[10px] uppercase text-gray-500 block font-sans">
                Median Move
              </span>
              <span
                className={`font-bold text-sm ${
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

        {/* Big Histogram Chart with Count on Bars */}
        <div className="h-[240px] sm:h-[320px] md:h-[400px] w-full mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 28, right: 10, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(v) => SHORT_LABELS[v] || v}
                interval={0}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                allowDecimals={false}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
              />
              <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                <LabelList
                  dataKey="count"
                  position="top"
                  fill="#cbd5e1"
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight={600}
                  formatter={(val: unknown) =>
                    typeof val === 'number' && val > 0 ? val.toLocaleString() : ''
                  }
                />
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
