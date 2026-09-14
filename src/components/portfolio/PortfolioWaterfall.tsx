'use client';

import React, { useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortfolioWaterfallProps {
  startingCapital: number;
  netDeposits: number;
  realizedGains: number;
  dividends: number;
  unrealizedGains: number;
  charges: number;
  tax: number;
  currentEquity: number;
  privacyMode?: boolean;
}

// Internal bar type for waterfall rendering
interface WaterfallBar {
  name: string;
  offset: number;       // invisible base (stacked below)
  value: number;        // visible segment (positive = additive, negative shows as red)
  display: number;      // absolute display value for tooltip
  type: 'start' | 'add' | 'sub' | 'total';
  color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatShort = (value: number, privacyMode: boolean): string => {
  if (privacyMode) return '••••';
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `₹${(value / 100_000).toFixed(2)}L`;
  if (abs >= 1_000)      return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toFixed(0)}`;
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({
  active,
  payload,
  privacyMode,
}: {
  active?: boolean;
  payload?: { payload: WaterfallBar }[];
  privacyMode: boolean;
}) => {
  if (!active || !payload?.length) return null;
  const bar = payload[0].payload;
  const isNegative = bar.type === 'sub';
  const isTotal = bar.type === 'total' || bar.type === 'start';

  return (
    <div className="bg-[#0c1220]/98 border border-white/10 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md min-w-[170px]">
      <p className="text-[11px] text-gray-400 mb-2 font-medium">{bar.name}</p>
      <p
        className={`text-base font-bold tabular-nums ${
          isTotal
            ? 'text-blue-400'
            : isNegative
            ? 'text-rose-400'
            : 'text-emerald-400'
        }`}
      >
        {isNegative ? '-' : isTotal ? '' : '+'}{privacyMode ? '••••' : formatCurrency(Math.abs(bar.display), 0, 0)}
      </p>
    </div>
  );
};

// ─── Bar label ────────────────────────────────────────────────────────────────

const BarLabel = ({
  x,
  y,
  width,
  value,
  privacyMode,
  type,
}: {
  x?: number;
  y?: number;
  width?: number;
  value?: number;
  privacyMode: boolean;
  type: WaterfallBar['type'];
}) => {
  if (value === undefined || value === null || Math.abs(value) < 1 || x === undefined || y === undefined || width === undefined) return null;
  const isNeg = type === 'sub';
  const label = formatShort(Math.abs(value), privacyMode);
  return (
    <text
      x={(x ?? 0) + (width ?? 0) / 2}
      y={isNeg ? (y ?? 0) + 14 : (y ?? 0) - 5}
      textAnchor="middle"
      fontSize={9}
      fill={isNeg ? '#f87171' : type === 'total' || type === 'start' ? '#93c5fd' : '#6ee7b7'}
    >
      {label}
    </text>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PortfolioWaterfall({
  startingCapital,
  netDeposits,
  realizedGains,
  dividends,
  unrealizedGains,
  charges,
  tax,
  currentEquity,
  privacyMode = false,
}: PortfolioWaterfallProps) {

  const { bars, yDomain } = useMemo(() => {
    let runningTotal = 0;
    const bars: WaterfallBar[] = [];

    const add = (
      name: string,
      amount: number,
      type: WaterfallBar['type'],
      color: string,
    ) => {
      if (amount === 0 && type !== 'total' && type !== 'start') return;
      const isNeg = type === 'sub';
      const offset = isNeg ? runningTotal + amount : runningTotal;
      bars.push({
        name,
        offset: Math.max(0, offset),
        value: Math.abs(amount),
        display: amount,
        type,
        color,
      });
      if (!isNeg) runningTotal += amount;
    };

    // Starting capital (anchor)
    bars.push({
      name: 'Starting Capital',
      offset: 0,
      value: startingCapital,
      display: startingCapital,
      type: 'start',
      color: '#3b82f6',
    });
    runningTotal = startingCapital;

    add('Net Deposits',      netDeposits,    'add', '#6366f1');   // indigo-500
    add('Realized Gains',   realizedGains,  realizedGains >= 0 ? 'add' : 'sub', realizedGains >= 0 ? '#10b981' : '#ef4444');
    if (dividends > 0) {
      add('Dividends',      dividends,      'add', '#f59e0b');   // amber-500
    }
    add('Unrealized Gains', unrealizedGains, unrealizedGains >= 0 ? 'add' : 'sub', unrealizedGains >= 0 ? '#34d399' : '#f87171');
    add('Charges',          -Math.abs(charges), 'sub', '#ef4444');
    add('Est. Tax',         -Math.abs(tax),     'sub', '#dc2626');

    // Total bar
    bars.push({
      name: 'Current Equity',
      offset: 0,
      value: currentEquity,
      display: currentEquity,
      type: 'total',
      color: '#3b82f6',
    });

    // Y domain with some headroom
    const allTops = bars.map(b => b.offset + b.value);
    const yMax = Math.max(...allTops) * 1.12;

    return { bars, yDomain: [0, yMax] as [number, number] };
  }, [startingCapital, netDeposits, realizedGains, dividends, unrealizedGains, charges, tax, currentEquity]);

  // Pct of current equity
  const pct = (v: number) =>
    currentEquity > 0 ? ((v / currentEquity) * 100).toFixed(1) + '%' : '—';

  const tooltipRenderer = useCallback(
    (props: object) => <CustomTooltip {...(props as Parameters<typeof CustomTooltip>[0])} privacyMode={privacyMode} />,
    [privacyMode]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <FontAwesomeIcon icon={faLayerGroup} className="text-blue-400 text-lg" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-200 leading-tight">Portfolio Compounding</h3>
          <p className="text-[11px] text-gray-500">How your portfolio grew from capital → current equity</p>
        </div>
      </div>

      {/* Breakdown chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-gray-400">Starting:</span>
          <span className="font-semibold text-blue-300">{formatShort(startingCapital, privacyMode)}</span>
        </div>
        {netDeposits > 0 && (
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-gray-400">Deposits:</span>
            <span className="font-semibold text-indigo-300">{formatShort(netDeposits, privacyMode)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <span className={`w-2 h-2 rounded-full ${realizedGains >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className="text-gray-400">Realized:</span>
          <span className={`font-semibold ${realizedGains >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {formatShort(realizedGains, privacyMode)} <span className="text-gray-500 font-normal">({pct(realizedGains)})</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <span className={`w-2 h-2 rounded-full ${unrealizedGains >= 0 ? 'bg-teal-400' : 'bg-orange-400'}`} />
          <span className="text-gray-400">Unrealized:</span>
          <span className={`font-semibold ${unrealizedGains >= 0 ? 'text-teal-300' : 'text-orange-300'}`}>
            {formatShort(unrealizedGains, privacyMode)} <span className="text-gray-500 font-normal">({pct(unrealizedGains)})</span>
          </span>
        </div>
        {dividends > 0 && (
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-gray-400">Dividends:</span>
            <span className="font-semibold text-amber-300">{formatShort(dividends, privacyMode)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span className="text-gray-400">Charges + Tax:</span>
          <span className="font-semibold text-rose-300">-{formatShort(charges + tax, privacyMode)}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 480 }}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={bars} margin={{ top: 24, right: 16, left: 0, bottom: 4 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: '#9ca3af', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
                interval={0}
              />
              <YAxis
                domain={yDomain}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => formatShort(v, privacyMode)}
                width={60}
              />
              <Tooltip content={tooltipRenderer} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />

              {/* Invisible offset (base) */}
              <Bar dataKey="offset" stackId="wf" fill="transparent" legendType="none" />

              {/* Visible bar segment */}
              <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]} maxBarSize={72}>
                {bars.map((bar, i) => (
                  <Cell key={i} fill={bar.color} fillOpacity={bar.type === 'start' || bar.type === 'total' ? 0.9 : 0.75} />
                ))}
                <LabelList
                  dataKey="display"
                  content={(labelProps) => {
                    const { x, y, width, value, index } = labelProps as {
                      x?: number; y?: number; width?: number; value?: number; index?: number;
                    };
                    if (index === undefined) return null;
                    const bar = bars[index];
                    if (!bar) return null;
                    return (
                      <BarLabel
                        x={x}
                        y={y}
                        width={width}
                        value={value}
                        privacyMode={privacyMode}
                        type={bar.type}
                      />
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Context note */}
      <p className="text-[10px] text-gray-600">
        Charges include STT, exchange fees, GST &amp; stamp duty. Tax is estimated net STCG/LTCG after loss offsets. Dividends shown only when Zerodha Tax P&amp;L data is uploaded.
      </p>
    </div>
  );
}
