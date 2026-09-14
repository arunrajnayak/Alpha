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
import { faMountain } from '@fortawesome/free-solid-svg-icons';

interface AthDistributionChartProps {
  distribution: DistributionBucket[];
  totalStocks: number;
  loading?: boolean;
}

const ATH_BUCKET_COLORS: Record<string, string> = {
  '0-5%': '#10b981', // emerald-500 (Breakout / ATH leader)
  '5-10%': '#34d399', // emerald-400 (Leader zone)
  '10-15%': '#06b6d4', // cyan-500 (Mild consolidation)
  '15-20%': '#38bdf8', // sky-400 (Base building)
  '20-30%': '#f59e0b', // amber-500 (Correction)
  '30-40%': '#f97316', // orange-500 (Deep pullback)
  '40-50%': '#ef4444', // red-500 (Severe drawdown)
  '> 50%': '#b91c1c', // red-700 (Laggard)
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

  return (
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[140px]">
      <span className="text-[11px] text-gray-400 font-medium block mb-1">
        Distance from ATH: <span className="text-gray-200 font-semibold">{data.label}</span>
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold font-mono text-white">
          {data.count}
        </span>
        <span className="text-xs text-gray-400 font-mono">
          ({data.percent}%)
        </span>
      </div>
    </div>
  );
};

export default function AthDistributionChart({
  distribution,
  totalStocks,
  loading = false,
}: AthDistributionChartProps) {
  const chartData = useMemo(() => {
    return distribution.map((b) => ({
      label: b.label,
      count: b.count,
      percent: b.percent,
      color: ATH_BUCKET_COLORS[b.label] || '#f59e0b',
    }));
  }, [distribution]);

  if (loading && distribution.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 md:p-5 h-[230px] animate-pulse" />
    );
  }

  // Calculate near ATH (within 20%) and deep drawdowns (>50%)
  const nearAthCount = distribution
    .filter((b) => ['0-5%', '5-10%', '10-15%', '15-20%'].includes(b.label))
    .reduce((acc, curr) => acc + curr.count, 0);

  const deepDrawdownCount = distribution
    .filter((b) => b.label === '> 50%')
    .reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-5 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FontAwesomeIcon icon={faMountain} className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-white tracking-tight">
                Distance Away from ATH
              </h3>
              <p className="text-[11px] text-gray-400">All-Time High drawdown spread</p>
            </div>
          </div>

          <div className="text-right text-xs font-mono">
            <span className="text-[10px] uppercase text-gray-500 block font-sans">
              Within 20% of ATH
            </span>
            <span className="font-bold text-emerald-400">
              {totalStocks > 0 ? ((nearAthCount / totalStocks) * 100).toFixed(1) : 0}%
            </span>
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
                  <Cell key={`ath-cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer Insight */}
      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-white/5 text-gray-400 font-mono">
        <span className="text-emerald-400">
          {nearAthCount} within 20%
        </span>
        <span className="text-gray-500 font-sans text-[10px]">
          {nearAthCount > deepDrawdownCount ? 'Expansion Phase' : 'Selective / Corrective'}
        </span>
        <span className="text-rose-400">
          {deepDrawdownCount} &gt; 50% off
        </span>
      </div>
    </div>
  );
}
