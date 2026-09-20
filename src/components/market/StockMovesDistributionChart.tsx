'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
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
  isMobile?: boolean;
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
  '< -15%': '< -15%',
  '-15% to -10%': '-15 to -10%',
  '-10% to -5%': '-10 to -5%',
  '-5% to -3%': '-5 to -3%',
  '-3% to -1%': '-3 to -1%',
  '-1% to 0%': '-1 to 0%',
  '0%': '0%',
  '0% to +1%': '0 to +1%',
  '+1% to +3%': '+1 to +3%',
  '+3% to +5%': '+3 to +5%',
  '+5% to +10%': '+5 to +10%',
  '+10% to +15%': '+10 to +15%',
  '> +15%': '> +15%',
};

const SHORT_LABELS_MOBILE: Record<string, string> = {
  '< -15%': '< -15%',
  '-15% to -10%': '-15 to -10',
  '-10% to -5%': '-10 to -5',
  '-5% to -3%': '-5 to -3',
  '-3% to -1%': '-3 to -1',
  '-1% to 0%': '-1 to 0',
  '0%': '0%',
  '0% to +1%': '0 to +1',
  '+1% to +3%': '+1 to +3',
  '+3% to +5%': '+3 to +5',
  '+5% to +10%': '+5 to +10',
  '+10% to +15%': '+10 to +15',
  '> +15%': '> +15%',
};

export default function StockMovesDistributionChart({
  distribution,
  medianMove,
  totalStocks,
  loading = false,
  isMobile: isMobileProp,
}: StockMovesDistributionChartProps) {
  const [isMobile, setIsMobile] = useState(isMobileProp ?? false);

  useEffect(() => {
    if (isMobileProp !== undefined) {
      setIsMobile(isMobileProp);
      return;
    }
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [isMobileProp]);
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
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3 sm:p-5 md:p-6 h-[310px] sm:h-[390px] md:h-[470px] animate-pulse" />
    );
  }

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-3 sm:p-5 md:p-6 shadow-xl relative overflow-hidden">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
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
              <AnimatePresence mode="wait">
                <motion.span
                  key={medianMove}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className={`font-bold text-sm ${
                    medianMove > 0
                      ? 'text-emerald-400'
                      : medianMove < 0
                      ? 'text-rose-400'
                      : 'text-gray-300'
                  }`}
                >
                  {medianMove > 0 ? `+${medianMove}%` : `${medianMove}%`}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Big Histogram Chart with Count on Bars */}
        <div className="h-[270px] sm:h-[320px] md:h-[400px] w-full mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={
                isMobile
                  ? { top: 24, right: 6, left: -24, bottom: 8 }
                  : { top: 28, right: 4, left: -24, bottom: 4 }
              }
            >
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tick={{ fill: '#94a3b8', fontSize: isMobile ? 9 : 10 }}
                tickFormatter={(v) => (isMobile ? SHORT_LABELS_MOBILE[v] || v : SHORT_LABELS[v] || v)}
                interval={0}
                angle={isMobile ? -45 : 0}
                textAnchor={isMobile ? 'end' : 'middle'}
                height={isMobile ? 55 : 24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: isMobile ? 9.5 : 11 }}
                allowDecimals={false}
              />

              <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                <LabelList
                  dataKey="count"
                  position="top"
                  fill="#cbd5e1"
                  fontSize={isMobile ? 9 : 11}
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
