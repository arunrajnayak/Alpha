'use client';

import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
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
  const [showAdvances, setShowAdvances] = useState(true);
  const [showDeclines, setShowDeclines] = useState(true);
  const [showNet, setShowNet] = useState(false);

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
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 md:p-6 h-[460px] animate-pulse" />
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

      {/* Top Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FontAwesomeIcon icon={faArrowTrendUp} className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2.5">
              <h3 className="font-semibold text-base md:text-lg text-white tracking-tight">
                Market breadth
              </h3>
              {total > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800/80 text-gray-300 border border-white/10 font-mono font-medium">
                  {total.toLocaleString()} Stocks
                </span>
              )}
            </div>
          </div>

          {/* Series Toggle Pills */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <button
              onClick={() => setShowAdvances((prev) => !prev)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                showAdvances
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 line-through opacity-60'
              }`}
            >
              Advances
            </button>
            <button
              onClick={() => setShowDeclines((prev) => !prev)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                showDeclines
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 line-through opacity-60'
              }`}
            >
              Declines
            </button>
            <button
              onClick={() => setShowNet((prev) => !prev)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                showNet
                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 opacity-60'
              }`}
            >
              Net A/D
            </button>
          </div>
        </div>

        {/* Big Numbers: Advances vs Declines vs A/D Ratio */}
        {(advances > 0 || declines > 0) && (
          <div className="grid grid-cols-3 gap-3 py-3.5 px-4 md:px-6 mb-3 bg-slate-800/40 rounded-xl border border-white/5">
            {/* Advances */}
            <div className="flex flex-col">
              <span className="text-[11px] uppercase font-semibold text-emerald-400/80 tracking-wider">
                Advances
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl md:text-3xl font-bold font-mono text-emerald-400">
                  {advances.toLocaleString()}
                </span>
                <span className="text-xs md:text-sm text-emerald-400/70 font-mono">
                  ({advPercent}%)
                </span>
              </div>
            </div>

            {/* A/D Ratio */}
            <div className="flex flex-col text-center">
              <span className="text-[11px] uppercase font-semibold text-gray-400 tracking-wider">
                A/D Ratio
              </span>
              <div className="flex items-baseline justify-center gap-1.5 mt-1">
                <span
                  className={`text-2xl md:text-3xl font-bold font-mono ${
                    adRatio >= 1 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {adRatio.toFixed(2)}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {netAdvances >= 0 ? `+${netAdvances}` : `${netAdvances}`}
                </span>
              </div>
            </div>

            {/* Declines */}
            <div className="flex flex-col text-right">
              <span className="text-[11px] uppercase font-semibold text-rose-400/80 tracking-wider">
                Declines
              </span>
              <div className="flex items-baseline justify-end gap-2 mt-1">
                <span className="text-xs md:text-sm text-rose-400/70 font-mono">
                  ({decPercent}%)
                </span>
                <span className="text-2xl md:text-3xl font-bold font-mono text-rose-400">
                  {declines.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Advance / Decline Bar */}
        {(advances > 0 || declines > 0) && (
          <div className="relative h-3 md:h-3.5 w-full rounded-full overflow-hidden flex bg-slate-800/80 shadow-inner mb-3">
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
        )}

        {/* Chart View (Enlarged) */}
        {points && points.length > 0 ? (
          <div className="h-[320px] md:h-[380px] w-full mt-3">
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
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={30}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  allowDecimals={false}
                />
                {showNet && (
                  <ReferenceLine
                    y={0}
                    stroke="rgba(255, 255, 255, 0.2)"
                    strokeDasharray="2 2"
                  />
                )}
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                />
                {showAdvances && (
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
                )}
                {showDeclines && (
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
                )}
                {showNet && (
                  <Line
                    type="monotone"
                    dataKey="netAdvances"
                    name="Net Advances"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#38bdf8', stroke: '#fff', strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[280px] md:h-[320px] w-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-white/10 rounded-xl my-3">
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
