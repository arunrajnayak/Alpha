'use client';

import React, { useState, useEffect, useTransition } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from 'recharts';
import { fetchMarketHealthHistory } from '@/app/actions/market-breadth';
import type { MarketHealthHistoryData } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartPulse, faShieldHalved, faMountain } from '@fortawesome/free-solid-svg-icons';

interface MarketHealthDashboardProps {
  initialData?: MarketHealthHistoryData | null;
}

type TimeframePeriod = '1Y' | 'ALL';

export default function MarketHealthDashboard({ initialData }: MarketHealthDashboardProps) {
  const [data, setData] = useState<MarketHealthHistoryData | null>(initialData || null);
  const [period, setPeriod] = useState<TimeframePeriod>('1Y');
  const [loading, setLoading] = useState(!initialData);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      setLoading(true);
      fetchMarketHealthHistory(period)
        .then((res) => {
          setData(res);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, [period]);

  const stats = data?.currentStats;

  const regimeBadgeColor =
    stats?.regime === 'Strong Bullish'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : stats?.regime === 'Bullish'
      ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
      : stats?.regime === 'Neutral'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

  return (
    <div className="flex flex-col gap-5 bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-6 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <FontAwesomeIcon icon={faHeartPulse} className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base md:text-lg font-bold text-white tracking-tight">
                Market Health & Breadth
              </h2>
              {stats && (
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${regimeBadgeColor}`}
                >
                  {stats.regime}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Moving average participation & ATH proximity trends across NSE universe
            </p>
          </div>
        </div>

        {/* Timeframe Toggles */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-white/5 self-start sm:self-auto">
          {(['1Y', 'ALL'] as TimeframePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                period === p
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Stat Cards (MomoIndia-inspired) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* Above 200 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 200 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-purple-400">
              {stats ? `${stats.pctAbove200Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Long-term</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Regime: {stats?.pctAbove200Dma && stats.pctAbove200Dma >= 50 ? 'Bull' : 'Bear'} filter</span>
        </div>

        {/* Above 50 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 50 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-blue-400">
              {stats ? `${stats.pctAbove50Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Intermediate</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Swing trend participation</span>
        </div>

        {/* Above 20 DMA */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Above 20 DMA</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-cyan-400">
              {stats ? `${stats.pctAbove20Dma}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Short-term</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Momentum thrust</span>
        </div>

        {/* Within 10% of ATH */}
        <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
          <span className="text-[11px] text-gray-400 font-medium">Within 10% of ATH</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-amber-400">
              {stats ? `${stats.pctNearAth10}%` : '—'}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">Near Highs</span>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">Expansion index</span>
        </div>
      </div>

      {/* Chart 1: Moving Average Breadth Over Time */}
      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faShieldHalved} className="w-3.5 h-3.5 text-purple-400" />
            <h3 className="text-sm font-semibold text-gray-200">
              Moving Average Breadth (% of Stocks Above DMA)
            </h3>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">50% line = Bull/Bear pivot</span>
        </div>

        <div className="h-[230px] w-full">
          {loading && !data ? (
            <div className="h-full bg-slate-800/50 rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.history || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(val) => {
                    const parts = val.split('-');
                    return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : val;
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  unit="%"
                />
                <ReferenceLine y={50} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1220',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
                  formatter={(val: any) => [
                    `${val ?? 0}%`,
                    '',
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                />
                <Line
                  type="monotone"
                  dataKey="pctAbove200Dma"
                  name="% Above 200 DMA"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pctAbove100Dma"
                  name="% Above 100 DMA"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pctAbove50Dma"
                  name="% Above 50 DMA"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pctAbove20Dma"
                  name="% Above 20 DMA"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Chart 2: All-Time High (ATH) Proximity Over Time */}
      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faMountain} className="w-3.5 h-3.5 text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-200">
              All-Time High (ATH) Proximity Spectrum
            </h3>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">% of stocks near ATH</span>
        </div>

        <div className="h-[210px] w-full">
          {loading && !data ? (
            <div className="h-full bg-slate-800/50 rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.history || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(val) => {
                    const parts = val.split('-');
                    return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : val;
                  }}
                />
                <YAxis
                  domain={[0, 'auto']}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0c1220',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
                  formatter={(val: any) => [
                    `${val ?? 0}%`,
                    '',
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                />
                <Line
                  type="monotone"
                  dataKey="pctNearAth10"
                  name="Within 10% of ATH"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pctNearAth20"
                  name="Within 20% of ATH"
                  stroke="#d97706"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="pctNearAth30"
                  name="Within 30% of ATH"
                  stroke="#92400e"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
