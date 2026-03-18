'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';

export interface MarketCapData {
  date: Date | string;
  largeCapPercent: number | null;
  midCapPercent: number | null;
  smallCapPercent: number | null;
  microCapPercent: number | null;
}

export interface MarketCapAreaChartProps {
  data: MarketCapData[];
}

export default function MarketCapAreaChart({ data }: MarketCapAreaChartProps) {
  const [hoveredCap, setHoveredCap] = useState<string | null>(null);

  const chartData = [...data]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(d => ({
      ...d,
      dateStr: format(typeof d.date === 'string' ? parseISO(d.date) : d.date, 'MMM dd, yyyy'),
      large: d.largeCapPercent || 0,
      mid: d.midCapPercent || 0,
      small: d.smallCapPercent || 0,
      micro: d.microCapPercent || 0,
    }));

  if (!data || data.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="text-gray-400">No market cap history available</p>
      </div>
    );
  }

  const CAP_CONFIG = [
      { key: 'large', label: 'Large Cap', color: '#22d3ee', gradId: 'colorLarge' },
      { key: 'mid', label: 'Mid Cap', color: '#a78bfa', gradId: 'colorMid' },
      { key: 'small', label: 'Small Cap', color: '#e879f9', gradId: 'colorSmall' },
      { key: 'micro', label: 'Micro Cap', color: '#a3e635', gradId: 'colorMicro' },
  ];

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      <div className="h-[300px] md:h-[500px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart
          data={chartData}
          stackOffset="expand"
          margin={{ top: 10, right: 5, left: -25, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorLarge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.95}/>
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.4}/>
            </linearGradient>
            <linearGradient id="colorMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.95}/>
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.4}/>
            </linearGradient>
            <linearGradient id="colorSmall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#e879f9" stopOpacity={0.95}/>
              <stop offset="95%" stopColor="#e879f9" stopOpacity={0.4}/>
            </linearGradient>
            <linearGradient id="colorMicro" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a3e635" stopOpacity={0.95}/>
              <stop offset="95%" stopColor="#a3e635" stopOpacity={0.4}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="dateStr"
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
          />
          <YAxis
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(17, 24, 39, 0.9)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              fontSize: '12px'
            }}
            itemStyle={{ padding: '2px 0' }}
            formatter={(value, name) => [typeof value === 'number' ? `${value.toFixed(1)}%` : '', name]}
          />
          {CAP_CONFIG.map((cap) => {
              const isHovered = hoveredCap === cap.key;
              const isDimmed = hoveredCap && !isHovered;
              
              return (
                <Area
                    key={cap.key}
                    type="monotone"
                    dataKey={cap.key}
                    name={cap.label}
                    stackId="1"
                    stroke={cap.color}
                    fill={`url(#${cap.gradId})`}
                    fillOpacity={isDimmed ? 0.1 : 1}
                    strokeWidth={isHovered ? 2 : 0}
                    strokeOpacity={isDimmed ? 0.2 : 1}
                    activeDot={{ r: 4 }}
                />
              );
          })}
        </AreaChart>
      </ResponsiveContainer>
      </div>

      {/* Interactive Legend */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4 px-4">
        {CAP_CONFIG.map((cap) => {
            const isHovered = hoveredCap === cap.key;
            const isDimmed = hoveredCap && !isHovered;

            return (
                <button
                    key={cap.key}
                    onMouseEnter={() => setHoveredCap(cap.key)}
                    onMouseLeave={() => setHoveredCap(null)}
                    className={`
                        flex items-center gap-2 py-1 transition-all duration-200 cursor-pointer
                        ${isHovered 
                            ? 'scale-105 opacity-100' 
                            : isDimmed 
                                ? 'opacity-30 blur-[0.5px]' 
                                : 'opacity-70 hover:opacity-100'}
                    `}
                >
                    <span 
                        className="w-6 h-1.5 rounded-full shadow-sm" 
                        style={{ backgroundColor: cap.color }} 
                    />
                    <span className="text-[11px] font-medium tracking-wide text-gray-300">
                        {cap.label}
                    </span>
                </button>
            );
        })}
      </div>
    </div>
  );
}
