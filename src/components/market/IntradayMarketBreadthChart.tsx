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
import type { IntradayBreadthPoint } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';

interface IntradayMarketBreadthChartProps {
  points: IntradayBreadthPoint[];
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
  date,
  isToday = true,
  isLive = false,
  loading = false,
}: IntradayMarketBreadthChartProps) {
  const [showAdvances, setShowAdvances] = useState(true);
  const [showDeclines, setShowDeclines] = useState(true);
  const [showNet, setShowNet] = useState(false);

  // Latest point
  const latest = useMemo(() => {
    if (!points || points.length === 0) return null;
    return points[points.length - 1];
  }, [points]);

  if (loading && (!points || points.length === 0)) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 md:p-5 h-[280px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm md:text-base text-white tracking-tight">
                Intraday Breadth Trend
              </h3>
              {isLive ? (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              ) : date ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-gray-400 border border-white/5 font-mono">
                  {date}
                </span>
              ) : null}
            </div>
          </div>

          {/* Series Toggle Pills (MUI-style controls) */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <button
              onClick={() => setShowAdvances((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition ${
                showAdvances
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 line-through opacity-60'
              }`}
            >
              Advances
            </button>
            <button
              onClick={() => setShowDeclines((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition ${
                showDeclines
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 line-through opacity-60'
              }`}
            >
              Declines
            </button>
            <button
              onClick={() => setShowNet((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition ${
                showNet
                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30 shadow-sm'
                  : 'bg-slate-800/40 text-gray-500 border-white/5 opacity-60'
              }`}
            >
              Net A/D
            </button>
          </div>
        </div>

        {/* Chart View */}
        {points && points.length > 0 ? (
          <div className="h-[250px] md:h-[280px] w-full mt-2">
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
          <div className="h-[250px] md:h-[280px] w-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-white/10 rounded-xl my-2">
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
            Last tick: <span className="text-gray-200 font-semibold">{latest.time}</span>
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
