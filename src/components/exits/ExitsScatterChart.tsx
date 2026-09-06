'use client';

import React, { useMemo, useState, useCallback } from 'react';
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
import { faCircleNodes, faBullseye } from '@fortawesome/free-solid-svg-icons';
import { formatNumber, formatCurrency } from '@/lib/format';
import { useLiveData } from '@/context/LiveDataContext';

export interface CurrentHoldingRecord {
  symbol: string;
  holdingPeriodDays?: number;
  pnlPercent?: number;
  pnl?: number;
  currentValue?: number;
  invested?: number;
}

interface ExitsScatterChartProps {
  exits: ExitRecord[];
  holdings?: CurrentHoldingRecord[];
}

interface ChartDataPoint {
  x: number;               // returns in %
  y: number;               // holding period in days
  symbol: string;
  gainLoss: number;
  netGainLoss: number;
  size: number;            // bubble size value
  color: string;           // bubble color based on gain/loss/holding
  isCurrentHolding: boolean;
  currentValue?: number;
  invested?: number;
}

// Custom tooltip component
const CustomTooltip = ({ active, payload }: any) => {
  const { privacyMode } = useLiveData();
  if (active && payload && payload.length) {
    const data = payload[0].payload as ChartDataPoint;
    const isGain = data.x >= 0;
    const netIsGain = data.netGainLoss >= 0;
    const isCurrent = data.isCurrentHolding;

    return (
      <div className="glass-card p-3 border border-white/10 shadow-2xl bg-slate-900/95 backdrop-blur-md rounded-xl min-w-[200px]">
        <div className="flex items-center justify-between gap-3 mb-2 pb-1.5 border-b border-white/10">
          <span className="text-sm font-bold text-white">{data.symbol}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
            isCurrent
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              : 'bg-slate-700/50 text-gray-300 border-white/10'
          }`}>
            {isCurrent ? 'Current Holding' : 'Realized Exit'}
          </span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">Return</span>
            <span className={`font-mono font-bold ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
              {data.x > 0 ? '+' : ''}{formatNumber(data.x, 2, 2)}%
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">Holding Period</span>
            <span className="font-mono text-gray-200">
              {data.y} days {isCurrent ? '(active)' : ''}
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-gray-400">{isCurrent ? 'Unrealized P&L' : 'Gross P&L'}</span>
            <span className={`font-mono font-medium ${data.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {privacyMode ? '••••' : formatCurrency(data.gainLoss, 0, 0)}
            </span>
          </div>
          {!isCurrent ? (
            <div className="flex justify-between gap-6 border-t border-white/10 pt-1">
              <span className="text-gray-400">Net P&L</span>
              <span className={`font-mono font-semibold ${netIsGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                {privacyMode ? '••••' : formatCurrency(data.netGainLoss, 0, 0)}
              </span>
            </div>
          ) : (
            data.currentValue !== undefined && (
              <div className="flex justify-between gap-6 border-t border-white/10 pt-1">
                <span className="text-gray-400">Holding Value</span>
                <span className="font-mono text-gray-200">
                  {privacyMode ? '••••' : formatCurrency(data.currentValue, 0, 0)}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    );
  }
  return null;
};

// Custom label component for scatter points
const renderCustomLabel = (props: any) => {
  const { x, y, value } = props;
  return (
    <text
      x={x}
      y={y - 10}
      fill="#9ca3af"
      fontSize={9.5}
      fontWeight={600}
      textAnchor="middle"
      className="pointer-events-none select-none"
    >
      {value}
    </text>
  );
};

export default function ExitsScatterChart({ exits = [], holdings = [] }: ExitsScatterChartProps) {
  const [filter, setFilter] = useState<'all' | 'exits' | 'holdings'>('all');

  // Calculate max return for normalization of profit/loss opacity scale
  const maxAbsReturn = useMemo(() => {
    if (exits.length === 0) return 1;
    const maxVal = Math.max(...exits.map(e => Math.abs(e.changePercent)));
    return maxVal === 0 ? 1 : maxVal;
  }, [exits]);

  const getExitColor = useCallback((returns: number) => {
    const isGain = returns >= 0;
    const absVal = Math.abs(returns);
    // Intensity scaling: 0.40 to 1.0 based on magnitude of profit/loss
    const intensity = Math.min(1, 0.40 + (absVal / maxAbsReturn) * 0.60);
    return isGain 
      ? `rgba(16, 185, 129, ${intensity.toFixed(2)})` 
      : `rgba(239, 68, 68, ${intensity.toFixed(2)})`;
  }, [maxAbsReturn]);

  const allPoints: ChartDataPoint[] = useMemo(() => {
    const exitPoints: ChartDataPoint[] = exits.map(exit => ({
      x: exit.changePercent,
      y: exit.timeHeld,
      symbol: exit.symbol,
      gainLoss: exit.gainLoss,
      netGainLoss: exit.netGainLoss ?? exit.gainLoss,
      size: 100,
      color: getExitColor(exit.changePercent),
      isCurrentHolding: false,
    }));

    const holdingPoints: ChartDataPoint[] = holdings.map(h => ({
      x: h.pnlPercent ?? 0,
      y: Math.max(0, h.holdingPeriodDays ?? 0),
      symbol: h.symbol,
      gainLoss: h.pnl ?? 0,
      netGainLoss: h.pnl ?? 0,
      size: 110,
      color: '#f59e0b', // Gold for current holdings
      isCurrentHolding: true,
      currentValue: h.currentValue,
      invested: h.invested,
    }));

    return [...exitPoints, ...holdingPoints];
  }, [exits, holdings, getExitColor]);

  const chartData = useMemo(() => {
    if (filter === 'exits') return allPoints.filter(p => !p.isCurrentHolding);
    if (filter === 'holdings') return allPoints.filter(p => p.isCurrentHolding);
    return allPoints;
  }, [allPoints, filter]);

  if (allPoints.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center">
            <FontAwesomeIcon icon={faBullseye} className="text-emerald-400 text-lg" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Holding Period vs Returns
          </span>
        </div>
        <div className="glass-card p-8 text-center animate-fade-in flex-1 flex flex-col items-center justify-center">
          <FontAwesomeIcon icon={faCircleNodes} className="text-4xl text-gray-600 mb-4 block" />
          <p className="text-gray-400">No trade or holding data to display</p>
        </div>
      </div>
    );
  }

  // Calculate domain for better visualization based on actual data range
  const xMin = chartData.length > 0 ? Math.min(...chartData.map(d => d.x)) : -10;
  const xMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.x)) : 10;
  const xRange = xMax - xMin;
  const xPadding = Math.max(5, xRange * 0.1);

  const yMin = chartData.length > 0 ? Math.min(...chartData.map(d => d.y)) : 0;
  const yMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.y)) : 100;
  const yRange = yMax - yMin;
  const yPadding = Math.max(10, yRange * 0.1);

  return (
    <div className="animate-fade-in-up h-full w-full flex flex-col justify-between">
      {/* Header with Title on Left and Filter Pills on Right */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faBullseye} className="text-emerald-400 text-lg" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Holding Period vs Returns
          </span>
        </div>

        {/* View Filter Pills */}
        <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-white/5 text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              filter === 'all' ? 'bg-slate-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            All ({allPoints.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('exits')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              filter === 'exits' ? 'bg-slate-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Exits ({exits.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('holdings')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              filter === 'holdings' ? 'bg-slate-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Holdings ({holdings.length})
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={430} minWidth={0}>
        <ScatterChart margin={{ top: 15, right: 15, left: -5, bottom: 25 }}>
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-holding" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.96  0 0 0 0 0.68  0 0 0 0 0.08  0 0 0 0.85 0" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
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
              offset={8}
              style={{ fill: '#9ca3af', fontSize: 11 }}
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
          />
          <ZAxis type="number" dataKey="size" range={[90, 110]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
          
          {/* Zero return reference line */}
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" />
          
          <Scatter 
            data={chartData} 
            fill="#8884d8"
            label={renderCustomLabel}
          >
            {chartData.map((entry, index) => {
              const isHolding = entry.isCurrentHolding;
              return (
                <Cell 
                  key={`cell-${entry.symbol}-${isHolding ? 'h' : 'e'}-${index}`} 
                  fill={entry.color}
                  fillOpacity={isHolding ? 0.95 : undefined}
                  stroke={isHolding ? '#fbbf24' : entry.color}
                  strokeWidth={isHolding ? 2 : 1}
                  style={{ filter: isHolding ? 'url(#glow-holding)' : 'url(#glow)' }}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend with Profit scale, Loss scale, and Current Holding */}
      <div className="flex flex-wrap justify-center items-center gap-6 md:gap-8 mt-3 pt-2 border-t border-white/5 text-xs text-gray-400">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-full opacity-40 bg-emerald-500" />
            <div className="w-3 h-3 rounded-full opacity-70 bg-emerald-500" />
            <div className="w-3 h-3 rounded-full opacity-100 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
          <span className="font-medium text-gray-300">Profit</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded-full opacity-40 bg-red-500" />
            <div className="w-3 h-3 rounded-full opacity-70 bg-red-500" />
            <div className="w-3 h-3 rounded-full opacity-100 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
          </div>
          <span className="font-medium text-gray-300">Loss</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-400 ring-2 ring-amber-400/40 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
          <span className="font-medium text-gray-300">Current Holding</span>
        </div>
      </div>
    </div>
  );
}
