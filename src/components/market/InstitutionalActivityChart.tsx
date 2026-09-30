'use client';

import React, { useState, useTransition, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Cell,
} from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { fetchInstitutionalActivity } from '@/app/actions/institutional';
import type {
  InstitutionalActivityResponse,
  InstitutionalActivityPoint,
  InstitutionalInterval,
} from '@/lib/upstox/institutional';

interface InstitutionalActivityChartProps {
  initialData?: InstitutionalActivityResponse | null;
}

function formatCrores(amount: number): string {
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}₹${formatted} Cr`;
}

function formatYAxisTick(val: number): string {
  if (val === 0) return '0';
  const sign = val > 0 ? '+' : '-';
  const absVal = Math.abs(val);
  if (absVal >= 1000) {
    const kVal = absVal / 1000;
    return `${sign}${Number.isInteger(kVal) ? kVal : kVal.toFixed(1)}k`;
  }
  return `${sign}${absVal}`;
}

/**
 * Finds a human-friendly step size (1, 2, 2.5, 5, 10 scaled by powers of 10)
 * that divides a value span cleanly into readable intervals.
 */
function getNiceStep(rawStep: number): number {
  if (rawStep <= 0) return 1000;
  const power = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, power);
  const normalized = rawStep / magnitude;

  let niceFraction: number;
  if (normalized < 1.25) {
    niceFraction = 1;
  } else if (normalized < 2.25) {
    niceFraction = 2;
  } else if (normalized < 3.75) {
    niceFraction = 2.5;
  } else if (normalized < 7.5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * magnitude;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: InstitutionalActivityPoint;
  }>;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="bg-[#121824]/95 border border-white/10 shadow-2xl rounded-2xl p-3.5 sm:p-4 min-w-[250px] text-xs backdrop-blur-md"
    >
      <div className="text-gray-200 font-semibold text-sm mb-1.5">
        {data.displayDate}
      </div>
      <div className="text-[10px] text-gray-500 mb-2 font-mono">
        {data.fullDate}
      </div>
      <div className="border-b border-dashed border-white/10 mb-2.5" />
      <div className="flex flex-col gap-2">
        {/* Net FII Activity */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-300 font-medium">Net FII Activity</span>
          <span
            className={`px-2 py-0.5 rounded font-mono font-semibold text-xs ${
              data.fiiNet >= 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {formatCrores(data.fiiNet)}
          </span>
        </div>

        {/* Net DII Activity */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-300 font-medium">Net DII Activity</span>
          <span
            className={`px-2 py-0.5 rounded font-mono font-semibold text-xs ${
              data.diiNet >= 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {formatCrores(data.diiNet)}
          </span>
        </div>

        {/* Net Inflow / Outflow */}
        <div className="border-b border-white/5 my-0.5" />
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-200 font-medium">Net Inflow / Outflow</span>
          <span
            className={`px-2 py-0.5 rounded font-mono font-semibold text-xs border ${
              data.netOverall >= 0
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                : 'bg-rose-500/15 text-rose-300 border-rose-500/20'
            }`}
          >
            {data.netOverall >= 0 ? '+' : ''}{formatCrores(data.netOverall)}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default function InstitutionalActivityChart({
  initialData,
}: InstitutionalActivityChartProps) {
  const [data, setData] = useState<InstitutionalActivityResponse | null>(
    initialData || null
  );
  const [interval, setInterval] = useState<InstitutionalInterval>(
    initialData?.interval || 'Daily'
  );
  const [showNetOverall, setShowNetOverall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleIntervalChange = (newInterval: InstitutionalInterval) => {
    if (newInterval === interval) return;
    setInterval(newInterval);
    setLoading(true);

    startTransition(async () => {
      try {
        const res = await fetchInstitutionalActivity(newInterval);
        setData(res);
      } catch (err) {
        console.error('Error switching institutional interval:', err);
      } finally {
        setLoading(false);
      }
    });
  };

  const points = useMemo(() => data?.points || [], [data?.points]);

  // Compute dynamic scale (domain & ticks) based on actual min & max values
  const { domain: yDomain, ticks: yTicks } = useMemo(() => {
    if (!points.length) {
      return { domain: [-5000, 5000], ticks: [-5000, 0, 5000] };
    }

    let minVal = 0;
    let maxVal = 0;

    for (const p of points) {
      if (showNetOverall) {
        if (p.netOverall < minVal) minVal = p.netOverall;
        if (p.netOverall > maxVal) maxVal = p.netOverall;
      } else {
        if (p.fiiNet < minVal) minVal = p.fiiNet;
        if (p.fiiNet > maxVal) maxVal = p.fiiNet;
        if (p.diiNet < minVal) minVal = p.diiNet;
        if (p.diiNet > maxVal) maxVal = p.diiNet;
      }
    }

    if (minVal === 0 && maxVal === 0) {
      return { domain: [-1000, 1000], ticks: [-1000, 0, 1000] };
    }

    const hasNegative = minVal < 0;
    const hasPositive = maxVal > 0;

    // Headroom factor (8%) so bars don't touch the top/bottom edges
    const paddedMax = hasPositive ? maxVal * 1.08 : 0;
    const paddedMin = hasNegative ? minVal * 1.08 : 0;
    const span = paddedMax - paddedMin;

    const targetIntervals = 4;
    let step = getNiceStep(span / targetIntervals);
    let topBound = hasPositive ? Math.ceil(paddedMax / step) * step : 0;
    let bottomBound = hasNegative ? Math.floor(paddedMin / step) * step : 0;
    const numIntervals = Math.round((topBound - bottomBound) / step);

    if (numIntervals > 6) {
      step = getNiceStep(span / 3);
      topBound = hasPositive ? Math.ceil(paddedMax / step) * step : 0;
      bottomBound = hasNegative ? Math.floor(paddedMin / step) * step : 0;
    }

    const ticks: number[] = [];
    for (let val = bottomBound; val <= topBound + step * 0.001; val += step) {
      const rounded = Math.round(val / (step * 0.01)) * (step * 0.01);
      ticks.push(rounded);
    }

    if (hasNegative && hasPositive && !ticks.includes(0)) {
      ticks.push(0);
      ticks.sort((a, b) => a - b);
    }

    return {
      domain: [bottomBound, topBound],
      ticks,
    };
  }, [points, showNetOverall]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-2xl p-3.5 sm:p-5 md:p-6 shadow-xl flex flex-col gap-4"
    >
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="px-3.5 py-1.5 rounded-xl border border-white/10 bg-slate-800/60 text-xs font-semibold text-gray-200 tracking-wide">
            FII & DII Trading Activity
          </div>
        </div>

        {/* Interval Selector Pills (Daily | Weekly | Monthly) */}
        <div className="flex items-center gap-1 bg-slate-800/60 border border-white/10 p-1 rounded-xl relative">
          {(['Daily', 'Weekly', 'Monthly'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleIntervalChange(tab)}
              disabled={loading || isPending}
              className={`relative px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                interval === tab
                  ? 'text-white'
                  : 'text-gray-400 hover:text-gray-200'
              } disabled:opacity-50 z-10`}
            >
              {interval === tab && (
                <motion.div
                  layoutId="institutionalIntervalPill"
                  className="absolute inset-0 bg-slate-700 rounded-lg shadow-sm -z-10"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="h-[280px] sm:h-[360px] md:h-[420px] w-full mt-1 relative overflow-hidden">
        <AnimatePresence>
          {(loading || isPending) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-xl"
            >
              <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            </motion.div>
          )}
        </AnimatePresence>

        {points.length === 0 && !loading && !isPending ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            No institutional trading activity available for this period.
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${interval}-${showNetOverall ? 'net' : 'split'}`}
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="w-full h-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={points}
                  margin={{ top: 15, right: 10, left: -15, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255, 255, 255, 0.08)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="displayDate"
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255, 255, 255, 0.1)' }}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    minTickGap={20}
                  />
                  <YAxis
                    domain={yDomain}
                    ticks={yTicks}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickFormatter={formatYAxisTick}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="rgba(255, 255, 255, 0.25)"
                    strokeDasharray="3 3"
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                    content={<CustomTooltip />}
                  />

                  {!showNetOverall ? (
                    <>
                      <Bar
                        dataKey="fiiNet"
                        name="Net FII Activity"
                        fill="#3B82F6"
                        radius={[3, 3, 3, 3]}
                        maxBarSize={16}
                        isAnimationActive={true}
                        animationDuration={600}
                        animationEasing="ease-out"
                      />
                      <Bar
                        dataKey="diiNet"
                        name="Net DII Activity"
                        fill="#F59E0B"
                        radius={[3, 3, 3, 3]}
                        maxBarSize={16}
                        isAnimationActive={true}
                        animationDuration={600}
                        animationEasing="ease-out"
                      />
                    </>
                  ) : (
                    <Bar
                      dataKey="netOverall"
                      name="Net Overall Activity"
                      radius={[4, 4, 4, 4]}
                      maxBarSize={22}
                      isAnimationActive={true}
                      animationDuration={600}
                      animationEasing="ease-out"
                    >
                      {points.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.netOverall >= 0 ? '#10B981' : '#EF4444'}
                        />
                      ))}
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Bottom Controls / Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-3 pb-1 border-t border-white/5">
        <AnimatePresence mode="wait">
          {!showNetOverall ? (
            <motion.div
              key="split-legend"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-4 sm:gap-6"
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#3B82F6]" />
                <span className="text-xs text-gray-300 font-medium">
                  Net FII Activity
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#F59E0B]" />
                <span className="text-xs text-gray-300 font-medium">
                  Net DII Activity
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="net-legend"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-4"
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#10B981]" />
                <span className="text-xs text-gray-300 font-medium">
                  Net Inflow (+ve)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-[#EF4444]" />
                <span className="text-xs text-gray-300 font-medium">
                  Net Outflow (-ve)
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Net Overall Activity Toggle Switch */}
        <div className="flex items-center gap-2.5 pl-2 sm:pl-4 sm:border-l sm:border-white/10">
          <button
            type="button"
            role="switch"
            aria-checked={showNetOverall}
            onClick={() => setShowNetOverall((prev) => !prev)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              showNetOverall ? 'bg-indigo-600' : 'bg-slate-700'
            }`}
          >
            <motion.span
              layout
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 ${
                showNetOverall ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <div className="flex items-center gap-1.5 text-xs text-gray-300 select-none">
            <span
              onClick={() => setShowNetOverall((prev) => !prev)}
              className="cursor-pointer hover:text-white"
            >
              Net Overall Activity
            </span>
            <div className="group relative flex items-center">
              <FontAwesomeIcon
                icon={faCircleInfo}
                className="w-3 h-3 text-gray-500 hover:text-gray-300 cursor-help transition-colors"
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 border border-white/10 text-[11px] text-gray-300 rounded-lg shadow-xl z-20 pointer-events-none">
                Combined institutional activity (FII + DII). When enabled, displays single net capital flow bar per period.
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
