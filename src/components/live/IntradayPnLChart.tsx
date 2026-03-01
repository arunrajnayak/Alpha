'use client';

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format } from 'date-fns';
import { PnLHistoryPoint } from '@/context/LiveDataContext';
import { formatCurrency } from '@/lib/format';
import type { Variants } from 'framer-motion';

interface IntradayPnLChartProps {
  data: PnLHistoryPoint[];
  itemVariants: Variants;
  privacyMode: boolean;
  isMobile: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, precision, privacyMode, isMobile }: any) {
  if (!active || !payload || !payload.length) return null;
  
  const percent = payload[0].value;
  const pnl = payload[0]?.payload?.pnl ?? 0;
  const isPositive = percent >= 0;
  const showMasked = privacyMode && !isMobile;
  
  return (
    <div className="bg-slate-800/95 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}{percent.toFixed(precision)}%
      </p>
      <p className={`text-xs font-semibold ${isPositive ? 'text-emerald-300/80' : 'text-red-300/80'}`}>
        {showMasked ? '****' : `${isPositive ? '+' : '-'}${formatCurrency(Math.abs(pnl))}`}
      </p>
    </div>
  );
}

const IntradayPnLChart = memo(function IntradayPnLChart({
  data,
  itemVariants,
  privacyMode,
  isMobile
}: IntradayPnLChartProps) {
  // Format data for chart
  // Format data for chart
  const chartData = useMemo(() => {
    // Dedup by minute (keep last point for each minute)
    const uniquePoints = new Map();
    
    data.forEach(point => {
      const minute = format(point.time, 'HH:mm');
      // Always overwrite, so we keep the latest for each minute
      uniquePoints.set(minute, point);
    });

    return Array.from(uniquePoints.values()).map(point => ({
      time: format(point.time, 'HH:mm:ss'),
      timeShort: format(point.time, 'HH:mm'),
      pnl: point.pnl,
      percent: point.percent
    }));
  }, [data]);

  // Determine if overall is positive (use last data point)
  const isPositive = chartData.length > 0 ? chartData[chartData.length - 1].percent >= 0 : true;
  
  // Find min and max for Y axis domain and calculate gradient offset
  const { minPercent, maxPercent, offsetFill, offsetStroke, precision } = useMemo(() => {
    if (chartData.length === 0) {
      return { minPercent: -1, maxPercent: 1, offsetFill: 0.5, offsetStroke: 0.5, precision: 2 };
    }

    // Calculate domain with padding to ensure zero line isn't clamped to the edge
    const percs = chartData.map(d => d.percent);
    const dataMin = Math.min(...percs);
    const dataMax = Math.max(...percs);
    const dataRange = dataMax - dataMin;
    const precision = dataRange < 0.5 ? 3 : dataRange < 2 ? 2 : 1;
    
    // Ensure 0 is included in the conceptual range before padding
    const domainMin = Math.min(dataMin, 0);
    const domainMax = Math.max(dataMax, 0);
    
    // Add 10% padding to the total range
    const range = Math.abs(domainMax - domainMin);
    const MIN_PAD_PCT = 0.02; // 2 bps minimum padding
    const padding = Math.max(range * 0.1, MIN_PAD_PCT);
    
    const finalMin = domainMin - padding;
    const finalMax = domainMax + padding;
    
    // Calculate offsets relative to specific bounding boxes
    
    // Stroke Offset: logic applies to data range [dataMin, dataMax]
    const strokeRange = dataMax - dataMin;
    const strokeOffset = strokeRange > 0 ? (dataMax - 0) / strokeRange : (dataMax >= 0 ? 1 : 0);
    
    // Fill Offset: logic applies to fill range [finalMin, dataMax] (assuming fill extends to bottom)
    // Note: Recharts Area typically fills to the axis bottom if baseValue is not set
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

  // Don't render if no data
  if (chartData.length < 2) {
    return null;
  }

  return (
    <motion.div 
      variants={itemVariants} 
      className={`relative overflow-hidden rounded-2xl border shadow-xl bg-gradient-to-br from-slate-900 via-slate-800/50 to-slate-900 ${
        isPositive ? 'border-emerald-500/20' : 'border-red-500/20'
      }`}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Intraday P/L</h3>
          </div>
        </div>
        
        <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="splitColorGradient" x1="0" y1="0" x2="0" y2="1">
                    {/* Green from top to zero line */}
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset={`${offsetFill * 100}%`} stopColor="#10b981" stopOpacity={0.1}/>
                    {/* Red from zero line to bottom */}
                    <stop offset={`${offsetFill * 100}%`} stopColor="#ef4444" stopOpacity={0.1}/>
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4}/>
                  </linearGradient>
                  <linearGradient id="splitColorStroke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981"/>
                    <stop offset={`${offsetStroke * 100}%`} stopColor="#10b981"/>
                    <stop offset={`${offsetStroke * 100}%`} stopColor="#ef4444"/>
                    <stop offset="100%" stopColor="#ef4444"/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timeShort" 
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  axisLine={{ stroke: '#374151' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[minPercent, maxPercent]}
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `${value.toFixed(precision)}%`}
                />
                <Tooltip 
                  content={<CustomTooltip precision={precision} privacyMode={privacyMode} isMobile={isMobile} />} 
                  cursor={{ stroke: '#4b5563', strokeDasharray: '4 4' }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" />
                <Area 
                  type="linear"
                  dataKey="percent" 
                  stroke="url(#splitColorStroke)"
                  strokeWidth={2}
                  fill="url(#splitColorGradient)"
                  activeDot={{ r: 4, strokeWidth: 0, fill: '#fff' }}
                  baseValue={minPercent}
                />
              </AreaChart>
            </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
});

export default IntradayPnLChart;
