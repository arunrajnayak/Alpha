'use client';

import { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format } from 'date-fns';
import { PnLHistoryPoint } from '@/context/LiveDataContext';

import type { Variants } from 'framer-motion';

interface IntradayPnLChartProps {
  data: PnLHistoryPoint[];
  itemVariants: Variants;
  privacyMode: boolean;
  isMobile: boolean;
}

// Benchmark series config — mirrors EquityCurve legend pattern
const BENCHMARKS = [
  { key: 'portfolio', dataKey: 'percent',       label: 'Portfolio',  color: '#10b981' },
  { key: 'nifty50',  dataKey: 'nifty50Percent', label: 'Nifty 50',   color: '#8b5cf6' },
  { key: 'n500m50',  dataKey: 'n500m50Percent', label: 'Nifty 500',    color: '#06b6d4' },
] as const;

type SeriesKey = (typeof BENCHMARKS)[number]['key'];

function CustomTooltip({ active, payload, label, seriesVisible, isPositive }: any) {
  if (!active || !payload || !payload.length) return null;

  const payloadMap = new Map();
  for (const entry of payload) {
    payloadMap.set(entry.dataKey, entry);
  }

  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl min-w-[150px]">
      <p className="text-[11px] font-medium text-gray-400 mb-2 pb-1.5 border-b border-white/8">{label}</p>
      <div className="flex flex-col gap-1.5">
        {BENCHMARKS.map(item => {
          if (seriesVisible && !seriesVisible[item.key]) return null;
          const entry = payloadMap.get(item.dataKey);
          const value = entry?.value ?? null;
          let formatted;
          if (value == null) {
            formatted = '—';
          } else {
            const sign = value >= 0 ? '+' : '';
            formatted = `${sign}${value.toFixed(2)}%`;
          }

          let itemColor: string = item.color;
          if (item.key === 'portfolio') {
            const isValPositive = value != null ? value >= 0 : isPositive;
            itemColor = isValPositive ? '#10b981' : '#ef4444';
          }

          return (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: itemColor }} />
                <span className="text-[11px] text-gray-400">{item.label}</span>
              </div>
              <span
                className="text-[12px] font-bold tabular-nums"
                style={{ color: value == null ? '#6b7280' : itemColor }}
              >
                {formatted}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}



const IntradayPnLChart = memo(function IntradayPnLChart({
  data,
  itemVariants,
  privacyMode,
  isMobile
}: IntradayPnLChartProps) {
  // Toggle pills state — all on by default
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    portfolio: true,
    nifty50: true,
    n500m50: true,
  });
  const [hoveredSeries, setHoveredSeries] = useState<SeriesKey | null>(null);

  const toggleSeries = (key: SeriesKey) =>
    setVisible(prev => ({ ...prev, [key]: !prev[key] }));

  // Format data for chart — dedup by minute (keep last point per minute)
  const chartData = useMemo(() => {
    const uniquePoints = new Map<string, PnLHistoryPoint>();
    data.forEach(point => {
      const minute = format(point.time, 'HH:mm');
      uniquePoints.set(minute, point);
    });

    return Array.from(uniquePoints.values()).map(point => ({
      time: format(point.time, 'HH:mm:ss'),
      timeShort: format(point.time, 'HH:mm'),
      pnl: point.pnl,
      percent: point.percent,
      nifty50Percent: point.nifty50Percent ?? null,
      n500m50Percent: point.n500m50Percent ?? null,
    }));
  }, [data]);

  // Determine overall direction (use last data point)
  const isPositive = chartData.length > 0 ? chartData[chartData.length - 1].percent >= 0 : true;

  // Y-axis domain + gradient offsets + precision
  const { minPercent, maxPercent, offsetFill, offsetStroke, precision } = useMemo(() => {
    if (chartData.length === 0) {
      return { minPercent: -1, maxPercent: 1, offsetFill: 0.5, offsetStroke: 0.5, precision: 2 };
    }

    // Collect all visible series values for a unified Y domain
    const allValues: number[] = [];
    chartData.forEach(d => {
      allValues.push(d.percent);
      if (d.nifty50Percent != null) allValues.push(d.nifty50Percent);
      if (d.n500m50Percent != null) allValues.push(d.n500m50Percent);
    });

    const percs = chartData.map(d => d.percent);
    const dataMin = Math.min(...percs);
    const dataMax = Math.max(...percs);
    const dataRange = dataMax - dataMin;
    const precision = dataRange < 0.5 ? 3 : dataRange < 2 ? 2 : 1;

    const domainMin = Math.min(Math.min(...allValues), 0);
    const domainMax = Math.max(Math.max(...allValues), 0);

    const range = Math.abs(domainMax - domainMin);
    const MIN_PAD_PCT = 0.02;
    const padding = Math.max(range * 0.1, MIN_PAD_PCT);

    const finalMin = domainMin - padding;
    const finalMax = domainMax + padding;

    // Gradient offsets relative to portfolio series range only
    const strokeRange = dataMax - dataMin;
    const strokeOffset = strokeRange > 0 ? (dataMax - 0) / strokeRange : (dataMax >= 0 ? 1 : 0);

    const fillTop = dataMax;
    const fillBottom = finalMin;
    const fillRange = fillTop - fillBottom;
    const fillOffset = fillRange > 0 ? (fillTop - 0) / fillRange : (fillTop >= 0 ? 1 : 0);

    return {
      minPercent: finalMin,
      maxPercent: finalMax,
      offsetStroke: Math.max(0, Math.min(1, strokeOffset)),
      offsetFill: Math.max(0, Math.min(1, fillOffset)),
      precision
    };
  }, [chartData]);

  // Don't render if insufficient data
  if (chartData.length < 2) return null;

  return (
    <motion.div
      variants={itemVariants}
      className={`relative overflow-hidden rounded-2xl border shadow-xl bg-gradient-to-br from-slate-900 via-slate-800/50 to-slate-900 ${
        isPositive ? 'border-emerald-500/20' : 'border-red-500/20'
      }`}
    >
      <div className="p-5">
        {/* Header */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Intraday P/L</h3>
        </div>

        {/* Chart */}
        <div className="h-[375px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="splitColorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset={`${offsetFill * 100}%`} stopColor="#10b981" stopOpacity={0.1} />
                  <stop offset={`${offsetFill * 100}%`} stopColor="#ef4444" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                </linearGradient>
                <linearGradient id="splitColorStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset={`${offsetStroke * 100}%`} stopColor="#10b981" />
                  <stop offset={`${offsetStroke * 100}%`} stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
              </defs>

              <XAxis
                dataKey="timeShort"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
                interval={Math.max(Math.floor(chartData.length / 6) - 1, 0)}
              />
              <YAxis
                domain={[minPercent, maxPercent]}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `${value.toFixed(1)}%`}
              />
              <Tooltip
                content={(props) => <CustomTooltip {...props} seriesVisible={visible} isPositive={isPositive} />}
                cursor={{ stroke: '#4b5563', strokeDasharray: '4 4' }}
              />
              <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" />

              {/* Portfolio area — split-color gradient */}
              <Area
                type="monotone"
                dataKey="percent"
                stroke="url(#splitColorStroke)"
                strokeWidth={hoveredSeries === 'portfolio' ? 4 : 3}
                fill="url(#splitColorGradient)"
                activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }}
                baseValue={minPercent}
                hide={!visible.portfolio}
              />

              {/* Nifty 50 benchmark line */}
              <Line
                type="monotone"
                dataKey="nifty50Percent"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: '#8b5cf6' }}
                connectNulls
                hide={!visible.nifty50}
              />

              {/* Nifty 500 benchmark line */}
              <Line
                type="monotone"
                dataKey="n500m50Percent"
                stroke="#06b6d4"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: '#06b6d4' }}
                connectNulls
                hide={!visible.n500m50}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Toggle pills — below chart, mirrors EquityCurve legend */}
        <div className="flex items-center justify-center gap-4 flex-wrap pt-3 mt-1 border-t border-white/5">
          {BENCHMARKS.map(item => {
            const isHidden = !visible[item.key];
            const isHovered = hoveredSeries === item.key;
            const isDimmed = hoveredSeries !== null && !isHovered;
            const itemColor = item.key === 'portfolio' ? (isPositive ? '#10b981' : '#ef4444') : item.color;

            return (
              <button
                key={item.key}
                onClick={() => toggleSeries(item.key)}
                onMouseEnter={() => setHoveredSeries(item.key)}
                onMouseLeave={() => setHoveredSeries(null)}
                className={`flex items-center gap-1.5 py-0.5 transition-all duration-200 cursor-pointer ${
                  isHidden ? 'opacity-40 grayscale' : ''
                } ${
                  isHovered
                    ? 'scale-105 opacity-100'
                    : isDimmed
                    ? 'opacity-30 blur-[0.5px]'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <span
                  className="w-5 h-1.5 rounded-full shadow-sm flex-shrink-0"
                  style={{ backgroundColor: itemColor }}
                />
                <span
                  className={`text-[11px] font-medium tracking-wide ${
                    isHidden ? 'text-gray-500 line-through' : 'text-gray-300'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
});

export default IntradayPnLChart;
