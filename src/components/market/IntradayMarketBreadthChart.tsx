'use client';

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { motion } from 'framer-motion';
import type { IntradayBreadthPoint, NSEMarketBreadthData } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowTrendUp } from '@fortawesome/free-solid-svg-icons';

interface IntradayMarketBreadthChartProps {
  points: IntradayBreadthPoint[];
  breadth?: NSEMarketBreadthData | null;
  date?: string;
  isToday?: boolean;
  isLive?: boolean;
  loading?: boolean;
}

interface TooltipPayloadItem {
  dataKey: string;
  name: string;
  value: number;
  color: string;
  payload: IntradayBreadthPoint;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;

  return (
    <div className="bg-[#0c1220]/95 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md min-w-[170px]">
      <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-white/10 text-xs">
        <span className="text-gray-400 font-medium">Time</span>
        <span className="text-gray-100 font-mono font-semibold">{label || data.time}</span>
      </div>
      <div className="space-y-1 text-xs font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Advances:
          </span>
          <span className="font-bold text-emerald-400">{data.advances.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-gray-300">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Declines:
          </span>
          <span className="font-bold text-rose-400">{data.declines.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
          <span className="flex items-center gap-1.5 text-gray-400">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            Net A/D:
          </span>
          <span
            className={`font-bold ${
              data.netAdvances >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {data.netAdvances >= 0 ? `+${data.netAdvances}` : data.netAdvances}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-gray-400">
          <span>A/D Ratio:</span>
          <span className="font-semibold text-gray-200">{data.adRatio.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

export default function IntradayMarketBreadthChart({
  points,
  breadth,
  loading = false,
}: IntradayMarketBreadthChartProps) {
  // Latest point from intraday snapshots
  const latest = useMemo(() => {
    if (!points || points.length === 0) return null;
    return points[points.length - 1];
  }, [points]);

  // Derive current breadth metrics: prefer live breadthData, fallback to latest intraday snapshot
  const advances = breadth?.advances ?? latest?.advances ?? 0;
  const declines = breadth?.declines ?? latest?.declines ?? 0;
  const unchanged = breadth?.unchanged ?? 0;
  const total = breadth?.total ?? (advances + declines + unchanged);
  const advPercent =
    breadth?.advPercent ?? (total > 0 ? Number(((advances / total) * 100).toFixed(1)) : 0);
  const decPercent =
    breadth?.decPercent ?? (total > 0 ? Number(((declines / total) * 100).toFixed(1)) : 0);
  const unchPercent = total > 0 ? Number(((unchanged / total) * 100).toFixed(1)) : 0;
  const adRatio =
    breadth?.adRatio ?? (declines > 0 ? Number((advances / declines).toFixed(2)) : advances);
  const netAdvances = breadth?.netAdvances ?? (advances - declines);

  if (loading && (!points || points.length === 0) && !breadth) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 md:p-6 h-[500px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Background Accent Glow */}
      <div
        className={`absolute -top-20 -right-20 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-15 ${
          netAdvances >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />

      {/* Top Header: Title on Left, Stocks Count on Right */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FontAwesomeIcon icon={faArrowTrendUp} className="w-3.5 h-3.5" />
            </div>
            <h3 className="font-semibold text-base md:text-lg text-white tracking-tight">
              Market breadth
            </h3>
          </div>

          {/* Stocks count badge placed in top right */}
          {total > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/80 text-gray-300 border border-white/10 font-mono font-medium">
              {total.toLocaleString()} Stocks
            </span>
          )}
        </div>

        {/* Sleek Blended Advances / A/D / Declines Stats & Slim Progress Bar */}
        {(advances > 0 || declines > 0) && (
          <div className="pt-3.5 pb-2">
            <div className="flex items-center justify-between text-xs md:text-sm font-mono mb-2 px-0.5">
              {/* Advances */}
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                <span className="text-gray-400 text-xs font-sans">Advances</span>
                <span className="font-bold text-emerald-400">{advances.toLocaleString()}</span>
                <span className="text-emerald-400/70 text-xs">({advPercent}%)</span>
              </div>

              {/* A/D Ratio */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 text-xs font-sans">A/D</span>
                <span className={`font-bold ${adRatio >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {adRatio.toFixed(2)}
                </span>
                <span className="text-gray-500 text-xs">
                  ({netAdvances >= 0 ? `+${netAdvances}` : netAdvances})
                </span>
              </div>

              {/* Declines */}
              <div className="flex items-center gap-2">
                <span className="text-rose-400/70 text-xs">({decPercent}%)</span>
                <span className="font-bold text-rose-400">{declines.toLocaleString()}</span>
                <span className="text-gray-400 text-xs font-sans">Declines</span>
                <span className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]" />
              </div>
            </div>

            {/* Slim dual-color progress bar */}
            <div className="relative h-2 w-full rounded-full overflow-hidden flex bg-slate-800/80 shadow-inner">
              <motion.div
                className="h-full bg-emerald-500"
                style={{ width: `${advPercent}%` }}
                initial={false}
                animate={{ width: `${advPercent}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
              {unchPercent > 0 && (
                <motion.div
                  className="h-full bg-slate-500/80"
                  style={{ width: `${unchPercent}%` }}
                  initial={false}
                  animate={{ width: `${unchPercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              )}
              <motion.div
                className="h-full bg-rose-500"
                style={{ width: `${decPercent}%` }}
                initial={false}
                animate={{ width: `${decPercent}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {/* Enlarged Intraday Trend Chart */}
        {points && points.length > 0 ? (
          <div className="h-[380px] md:h-[460px] w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 16, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={30}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="advances"
                  name="Advances"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="declines"
                  name="Declines"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[360px] md:h-[440px] w-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-white/10 rounded-xl my-3">
            <span className="text-xs text-gray-400 mb-1 font-medium">
              No intraday snapshots recorded yet
            </span>
            <p className="text-[11px] text-gray-500 max-w-xs">
              Snapshots are recorded every minute between 09:15 AM and 03:40 PM IST on trading days.
            </p>
          </div>
        )}
      </div>

      {/* Footer Info */}
      {latest && (
        <div className="flex items-center justify-between text-[11px] pt-3 mt-3 border-t border-white/5 text-gray-400 font-mono">
          <span className="text-gray-400">
            Last snapshot: <span className="text-gray-200 font-semibold">{latest.time}</span>
          </span>
          <span
            className={latest.netAdvances >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}
          >
            Net {latest.netAdvances >= 0 ? `+${latest.netAdvances}` : latest.netAdvances}
          </span>
          <span className="text-gray-400">
            A/D: <span className="text-gray-200 font-semibold">{latest.adRatio.toFixed(2)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
