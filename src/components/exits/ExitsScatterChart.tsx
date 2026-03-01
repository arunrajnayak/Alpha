'use client';

import React, { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
  Label,
  ReferenceLine,
} from 'recharts';
import { ExitRecord } from '@/lib/exits';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNodes } from '@fortawesome/free-solid-svg-icons';
import { formatNumber, formatCurrency } from '@/lib/format';

interface ExitsScatterChartProps {
  exits: ExitRecord[];
}

interface ChartDataPoint {
  x: number;        // returns in %
  y: number;        // holding period in days
  symbol: string;
  gainLoss: number;
  size: number;     // bubble size value
  color: string;    // bubble color based on gain/loss
}

// Custom tooltip component
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as ChartDataPoint;
    const isGain = data.x >= 0;
    
    return (
      <div className="glass-card p-3 border border-white/10 shadow-xl bg-black/90 backdrop-blur-md min-w-[180px]">
        <p className="text-sm font-semibold text-white mb-2">{data.symbol}</p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">Return</span>
            <span className={`font-mono font-medium ${isGain ? 'text-green-400' : 'text-red-400'}`}>
              {data.x > 0 ? '+' : ''}{formatNumber(data.x, 2, 2)}%
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">Holding Period</span>
            <span className="font-mono text-gray-200">{data.y} days</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">P&L</span>
            <span className={`font-mono font-medium ${data.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(data.gainLoss, 0, 0)}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// Custom label component for scatter points
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderCustomLabel = (props: any) => {
  const { x, y, value } = props;
  return (
    <text
      x={x}
      y={y - 12}
      fill="#9ca3af"
      fontSize={10}
      textAnchor="middle"
      className="pointer-events-none"
    >
      {value}
    </text>
  );
};

export default function ExitsScatterChart({ exits }: ExitsScatterChartProps) {
  // Calculate max return for normalization
  const maxAbsReturn = useMemo(() => {
    if (exits.length === 0) return 1;
    const maxVal = Math.max(...exits.map(e => Math.abs(e.changePercent)));
    return maxVal === 0 ? 1 : maxVal;
  }, [exits]);

  const getPointColor = React.useCallback((returns: number) => {
    const isGain = returns >= 0;
    const absVal = Math.abs(returns);
    
    // Intensity scaling: 
    // Minimum 0.55 opacity for visibility
    // Scale the remaining 0.45 based on relative return magnitude
    const intensity = 0.55 + (absVal / maxAbsReturn) * 0.45;

    if (isGain) {
      return `rgba(34, 197, 94, ${intensity})`; // Green-500
    } else {
      return `rgba(239, 68, 68, ${intensity})`; // Red-500
    }
  }, [maxAbsReturn]);

  const chartData: ChartDataPoint[] = useMemo(() => {
    return exits.map(exit => {
      return {
        x: exit.changePercent,
        y: exit.timeHeld,
        symbol: exit.symbol,
        gainLoss: exit.gainLoss,
        size: 100, // Reduced size
        color: getPointColor(exit.changePercent),
      };
    });
  }, [exits, getPointColor]);

  // Calculate domain for better visualization based on actual data range
  const xMin = Math.min(...chartData.map(d => d.x));
  const xMax = Math.max(...chartData.map(d => d.x));
  const xRange = xMax - xMin;
  const xPadding = Math.max(5, xRange * 0.1); // 10% padding, minimum 5%

  const yMin = Math.min(...chartData.map(d => d.y));
  const yMax = Math.max(...chartData.map(d => d.y));
  const yRange = yMax - yMin;
  const yPadding = Math.max(10, yRange * 0.1); // 10% padding, minimum 10 days

  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile(); // Check on mount
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (exits.length === 0) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in">
        <FontAwesomeIcon icon={faCircleNodes} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400">No exit data to display</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up h-full w-full">
      
      <ResponsiveContainer width="100%" height={450} minWidth={0}>
        <ScatterChart margin={{ top: 20, right: 10, left: -10, bottom: 30 }}>
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis 
            type="number" 
            dataKey="x" 
            name="Return %" 
            domain={[Math.floor(xMin - xPadding), Math.ceil(xMax + xPadding)]}
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(value) => `${value}%`}
          >
            <Label 
              value="Returns (%)" 
              position="bottom" 
              offset={10}
              style={{ fill: '#9ca3af', fontSize: 12 }}
            />
          </XAxis>
          <YAxis 
            type="number" 
            dataKey="y" 
            name="Holding Period" 
            domain={[Math.max(0, Math.floor(yMin - yPadding)), Math.ceil(yMax + yPadding)]}
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(value) => `${value}d`}
          >
            {!isMobile && (
            <Label 
              value="Holding Period (days)" 
              angle={-90} 
              position="insideLeft" 
              offset={10}
              style={{ fill: '#9ca3af', fontSize: 12, textAnchor: 'middle' }}
            />
            )}
          </YAxis>
          <ZAxis type="number" dataKey="size" range={[100, 100]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
          
          {/* Zero return reference line */}
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" />
          
          <Scatter 
            data={chartData} 
            fill="#8884d8"
            label={renderCustomLabel}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.color}
                fillOpacity={0.8}
                stroke={entry.color}
                strokeWidth={1}
                style={{ filter: 'url(#glow)' }}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex justify-center items-center gap-8 mt-4">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-full opacity-40 bg-red-500" />
            <div className="w-3 h-3 rounded-full opacity-70 bg-red-500" />
            <div className="w-3 h-3 rounded-full opacity-100 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" />
          </div>
          <span className="text-xs font-medium text-gray-400">Loss</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-full opacity-40 bg-emerald-500" />
            <div className="w-3 h-3 rounded-full opacity-70 bg-emerald-500" />
            <div className="w-3 h-3 rounded-full opacity-100 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
          </div>
          <span className="text-xs font-medium text-gray-400">Profit</span>
        </div>
      </div>
    </div>
  );
}
