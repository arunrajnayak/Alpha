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
import { faTrophy } from '@fortawesome/free-solid-svg-icons';

interface AthDistributionChartProps {
  distribution: DistributionBucket[];
  totalStocks?: number;
  loading?: boolean;
}

const ATH_BUCKET_COLORS: Record<string, string> = {
  '0-5%': '#10b981', // emerald-500 (Breakout / ATH leader)
  '5-10%': '#34d399', // emerald-400 (Leader zone)
  '10-15%': '#06b6d4', // cyan-500 (Mild consolidation)
  '15-20%': '#38bdf8', // sky-400 (Base building)
  '20-30%': '#fbbf24', // amber-400 (Correction)
  '30-40%': '#f59e0b', // amber-500 (Deep pullback)
  '40-50%': '#f97316', // orange-500 (Severe correction)
  '50-60%': '#ef4444', // red-500 (Deep drawdown)
  '60-70%': '#dc2626', // red-600
  '70-80%': '#b91c1c', // red-700
  '80-90%': '#991b1b', // red-800
  '90-100%': '#7f1d1d', // red-900 (Distressed / bottom)
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
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[150px]">
      <span className="text-[11px] text-gray-400 font-medium block mb-1">
        Distance from ATH: <span className="text-gray-200 font-semibold">{data.label}</span>
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold font-mono text-white">
          {data.count}
        </span>
        <span className="text-xs text-gray-400 font-mono">
          stocks ({data.percent}%)
        </span>
      </div>
    </div>
  );
};

export default function AthDistributionChart({
  distribution,
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
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 md:p-6 h-[420px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FontAwesomeIcon icon={faTrophy} className="w-3.5 h-3.5" />
            </div>
            <h3 className="font-semibold text-base md:text-lg text-white tracking-tight">
              Distance Away from ATH
            </h3>
          </div>
        </div>

        {/* Big Histogram Chart with Count on Bars */}
        <div className="h-[340px] md:h-[400px] w-full mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 28, right: 10, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
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
                  <Cell key={`ath-cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
