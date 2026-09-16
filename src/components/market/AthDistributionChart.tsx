'use client';

import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { DistributionBucket } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrophy } from '@fortawesome/free-solid-svg-icons';
import { motion, AnimatePresence } from 'framer-motion';

interface AthDistributionChartProps {
  distribution: DistributionBucket[];
  totalStocks?: number;
  loading?: boolean;
}

interface ChartPoint {
  distance: number;
  label: string;
  count: number;
  percent: number;
  color: string;
}

function getColorForDistance(pct: number): string {
  if (pct < 10) return '#10b981'; // Emerald (Leaders / ATH)
  if (pct < 20) return '#06b6d4'; // Cyan (Consolidation)
  if (pct < 35) return '#3b82f6'; // Blue (Healthy Pullback)
  if (pct < 50) return '#eab308'; // Amber (Correction)
  if (pct < 70) return '#f97316'; // Orange (Deep Correction)
  if (pct < 85) return '#ef4444'; // Red (Drawdown)
  return '#991b1b'; // Crimson (Deep Bottom)
}

function upgradeTo100(oldBuckets: DistributionBucket[]): DistributionBucket[] {
  const result: DistributionBucket[] = [];
  for (let i = 0; i < 100; i++) {
    result.push({ label: `${i}%`, min: i, max: i === 99 ? Infinity : i + 1, count: 0, percent: 0 });
  }
  if (!oldBuckets || oldBuckets.length === 0) return result;

  for (const b of oldBuckets) {
    const min = Math.max(0, Math.floor(b.min));
    const max = b.max === Infinity ? 100 : Math.min(100, Math.ceil(b.max));
    const span = Math.max(1, max - min);
    const countPer = b.count / span;
    const percentPer = b.percent / span;
    for (let i = min; i < max; i++) {
      result[i].count += countPer;
      result[i].percent += percentPer;
    }
  }

  for (const b of result) {
    b.count = Math.round(b.count);
    b.percent = Number(b.percent.toFixed(2));
  }
  return result;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const nextVal = data.distance === 99 ? '100%+' : `${data.distance + 1}%`;

  return (
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[190px]">
      <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-white/10 text-xs">
        <span className="text-gray-400 font-medium">Distance from ATH</span>
        <span className="text-gray-100 font-mono font-semibold">
          {data.distance}% – {nextVal}
        </span>
      </div>
      <div className="space-y-1 text-xs font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-gray-300">
            <span
              className="w-2 h-2 rounded-full shadow-[0_0_6px_currentColor]"
              style={{ backgroundColor: data.color, color: data.color }}
            />
            Stocks:
          </span>
          <span className="font-bold text-white">{data.count.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-gray-400">
          <span>Universe Share:</span>
          <span className="font-semibold text-gray-200">{data.percent.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
};

export default function AthDistributionChart({
  distribution,
  totalStocks,
  loading = false,
}: AthDistributionChartProps) {
  const chartData: ChartPoint[] = useMemo(() => {
    if (!distribution || distribution.length === 0) return [];
    const buckets100 = distribution.length === 100 ? distribution : upgradeTo100(distribution);

    return buckets100.map((b, idx) => ({
      distance: idx,
      label: `${idx}%`,
      count: b.count,
      percent: b.percent,
      color: getColorForDistance(idx),
    }));
  }, [distribution]);

  const stats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return {
        within10Count: 0,
        within10Pct: 0,
        within20Count: 0,
        within20Pct: 0,
        medianDistance: 0,
        total: 0,
      };
    }
    const computedTotal = chartData.reduce((acc, d) => acc + d.count, 0);
    const total = totalStocks && totalStocks > 0 ? totalStocks : computedTotal;

    const within10Count = chartData.slice(0, 10).reduce((acc, d) => acc + d.count, 0);
    const within20Count = chartData.slice(0, 20).reduce((acc, d) => acc + d.count, 0);

    // Median distance from cumulative frequency
    const half = (computedTotal || total) / 2;
    let cum = 0;
    let medianDistance = 0;
    for (let i = 0; i < chartData.length; i++) {
      cum += chartData[i].count;
      if (cum >= half) {
        const prevCum = cum - chartData[i].count;
        const frac = chartData[i].count > 0 ? (half - prevCum) / chartData[i].count : 0;
        medianDistance = Number((i + frac).toFixed(1));
        break;
      }
    }

    return {
      within10Count,
      within10Pct: total > 0 ? Number(((within10Count / total) * 100).toFixed(1)) : 0,
      within20Count,
      within20Pct: total > 0 ? Number(((within20Count / total) * 100).toFixed(1)) : 0,
      medianDistance,
      total,
    };
  }, [chartData, totalStocks]);

  if (loading && distribution.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3 sm:p-5 md:p-6 h-[310px] sm:h-[390px] md:h-[470px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-3 sm:p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Background Accent Glow */}
      <div className="absolute -top-24 -left-24 w-56 h-56 rounded-full blur-3xl pointer-events-none opacity-10 bg-emerald-500" />
      <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full blur-3xl pointer-events-none opacity-10 bg-rose-500" />

      {/* Top Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2 sm:mb-3 pb-2.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FontAwesomeIcon icon={faTrophy} className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="font-semibold text-base md:text-lg text-white tracking-tight">
                Distance Away from ATH
              </h3>
              <p className="text-[11px] text-gray-400 hidden sm:block">
                100 fine-grained 1% drawdown buckets across all active stocks
              </p>
            </div>
          </div>

          {/* Metric Pills in Header */}
          {stats.total > 0 && (
            <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono flex-wrap">
              {/* Leader Zone (< 10% ATH) */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                <span className="text-[10px] text-emerald-400/80 font-sans uppercase">
                  &lt;10% ATH:
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={stats.within10Count}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.2 }}
                    className="font-bold text-emerald-400"
                  >
                    {stats.within10Count.toLocaleString()} ({stats.within10Pct}%)
                  </motion.span>
                </AnimatePresence>
              </div>

              {/* Near ATH (< 20% ATH) */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hidden md:flex">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                <span className="text-[10px] text-cyan-400/80 font-sans uppercase">
                  &lt;20% ATH:
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={stats.within20Count}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.2 }}
                    className="font-bold text-cyan-400"
                  >
                    {stats.within20Count.toLocaleString()} ({stats.within20Pct}%)
                  </motion.span>
                </AnimatePresence>
              </div>

              {/* Median Drawdown */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-white/10">
                <span className="text-[10px] text-gray-400 font-sans uppercase">
                  Median:
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={stats.medianDistance}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.2 }}
                    className="font-bold text-amber-400"
                  >
                    {stats.medianDistance}%
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* 100-Bucket Colorful Area Chart */}
        <div className="h-[240px] sm:h-[320px] md:h-[400px] w-full mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 16, right: 10, left: -20, bottom: 0 }}
            >
              <defs>
                {/* Horizontal multi-color stroke gradient */}
                <linearGradient id="athStrokeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="8%" stopColor="#10b981" />
                  <stop offset="15%" stopColor="#06b6d4" />
                  <stop offset="25%" stopColor="#3b82f6" />
                  <stop offset="40%" stopColor="#eab308" />
                  <stop offset="55%" stopColor="#f97316" />
                  <stop offset="75%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#991b1b" />
                </linearGradient>

                {/* Horizontal multi-color fill gradient */}
                <linearGradient id="athAreaGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="8%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="15%" stopColor="#06b6d4" stopOpacity={0.35} />
                  <stop offset="25%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="40%" stopColor="#eab308" stopOpacity={0.35} />
                  <stop offset="55%" stopColor="#f97316" stopOpacity={0.35} />
                  <stop offset="75%" stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#991b1b" stopOpacity={0.45} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="rgba(255, 255, 255, 0.05)"
                strokeDasharray="3 3"
                vertical={false}
              />

              <XAxis
                dataKey="distance"
                type="number"
                domain={[0, 99]}
                ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99]}
                tickFormatter={(val) => (val === 99 ? '100%' : `${val}%`)}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />

              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                allowDecimals={false}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1 }}
              />

              {/* Reference line for leader zone (< 10%) */}
              <ReferenceLine
                x={10}
                stroke="rgba(16, 185, 129, 0.4)"
                strokeDasharray="3 3"
              />

              {/* Reference line for correction zone (< 20%) */}
              <ReferenceLine
                x={20}
                stroke="rgba(6, 182, 212, 0.4)"
                strokeDasharray="3 3"
              />

              <Area
                type="monotone"
                dataKey="count"
                name="Stocks"
                stroke="url(#athStrokeGradient)"
                strokeWidth={2.5}
                fill="url(#athAreaGradient)"
                isAnimationActive={true}
                animationDuration={600}
                animationEasing="ease-out"
                activeDot={{
                  r: 4.5,
                  stroke: '#ffffff',
                  strokeWidth: 2,
                  fill: '#10b981',
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend strip below chart */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-500 pt-2 border-t border-white/5 font-sans mt-2">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              0–10% Breakout Leaders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              10–20% Pullback / Consolidation
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              20–50% Correction
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              &gt;50% Drawdown
            </span>
          </div>
          <span className="text-gray-500 font-mono text-[10px] hidden sm:inline">
            Hover along curve to inspect any 1% bucket
          </span>
        </div>
      </div>
    </div>
  );
}
