'use client';

import { useState, useMemo, memo } from 'react';
import { ResponsiveTreeMap } from '@nivo/treemap';
import { formatNumber } from '@/lib/format';
import { motion } from 'framer-motion';
import StockChartModal from '@/components/chart/StockChartModal';

export interface PortfolioHoldingItem {
  symbol: string;
  currentValue: number;
  dayChangePercent: number;
  dayChange?: number;
  currentPrice?: number;
  marketCapCategory?: string;
  sector?: string;
  formattedValue: string;
  totalPnlPercent?: number;
}

interface PortfolioHeatmapProps {
  data: {
    allHoldings: PortfolioHoldingItem[];
  };
  isMobile: boolean;
  privacyMode: boolean;
}

export function getHeatmapColor(percent: number | undefined): string {
  if (percent === undefined) return 'rgba(0,0,0,0)';
  if (percent >= 10) return '#059669'; // Emerald 600
  if (percent >= 5) return '#10b981';  // Emerald 500
  if (percent >= 3) return '#34d399';  // Emerald 400
  if (percent >= 1.5) return '#6ee7b7'; // Emerald 300
  if (percent > 0) return '#d1fae5';   // Emerald 100
  if (percent === 0) return '#64748b'; // Slate 500
  if (percent > -1.5) return '#fee2e2'; // Red 100
  if (percent > -3) return '#fca5a5';   // Red 300
  if (percent > -5) return '#f87171';   // Red 400
  if (percent > -10) return '#ef4444';  // Red 500
  return '#b91c1c';                     // Red 700
}

export function getHeatmapTextColor(percent: number | undefined): string {
  if (percent === undefined) return '#ffffff';
  if (percent > 0 && percent < 5) return '#0f172a';
  if (percent < 0 && percent > -5) return '#0f172a';
  return '#ffffff';
}

export function getCapColor(cap: string | undefined): string {
  const c = (cap || '').toLowerCase();
  if (c.includes('large')) return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
  if (c.includes('mid')) return 'bg-violet-500/20 text-violet-400 border border-violet-500/30';
  if (c.includes('small')) return 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30';
  if (c.includes('micro')) return 'bg-lime-500/20 text-lime-400 border border-lime-500/30';
  return 'bg-slate-700/50 text-gray-400 border border-white/5';
}

export default memo(function PortfolioHeatmap({ data, isMobile, privacyMode }: PortfolioHeatmapProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const allHoldings = useMemo(() => data?.allHoldings || [], [data?.allHoldings]);

  const totalValue = useMemo(() => {
    return allHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }, [allHoldings]);

  const selectedHolding = useMemo(() => {
    if (!selectedSymbol) return null;
    return allHoldings.find(h => h.symbol === selectedSymbol) || null;
  }, [selectedSymbol, allHoldings]);

  const treeData = useMemo(() => ({
    name: 'Portfolio',
    color: 'transparent',
    children: allHoldings.map(h => ({
      ...h,
      name: h.symbol,
      value: Math.max(h.currentValue, 1),
    })),
  }), [allHoldings]);

  if (allHoldings.length === 0) return null;

  const containerHeight = isMobile ? 420 : 500;

  return (
    <div
      className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 flex flex-col transition-all duration-200"
      style={{ height: containerHeight }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">
          Portfolio Heatmap
        </h3>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 w-full min-h-0 relative" style={{ color: '#000' }}>
          <ResponsiveTreeMap
            data={treeData}
            identity="name"
            value="value"
            valueFormat={val => formatNumber(val, 0, 0)}
            margin={isMobile ? { top: 0, right: 4, bottom: 4, left: 4 } : { top: 0, right: 8, bottom: 8, left: 8 }}
            labelSkipSize={isMobile ? 18 : 28}
            innerPadding={isMobile ? 2 : 3}
            outerPadding={isMobile ? 2 : 3}
            colors={node => getHeatmapColor((node.data as { dayChangePercent?: number }).dayChangePercent)}
            nodeOpacity={1}
            nodeComponent={({ node }) => {
              const d = node.data as { dayChangePercent?: number; currentValue?: number };
              const percent = d.dayChangePercent;
              if (percent === undefined) return null;

              const isSelected = selectedSymbol === node.id;
              const textColor = getHeatmapTextColor(percent);
              const pad = isMobile ? 2 : 3;
              const availW = Math.max(0, node.width - pad * 2 - 2);
              const availH = Math.max(0, node.height - pad * 2 - 2);

              const CHAR_RATIO = 0.58;
              const minPercentH = isMobile ? 26 : 30;
              const minPercentW = isMobile ? 30 : 36;
              const showPercent = availH >= minPercentH && availW >= minPercentW;

              const maxFs = isMobile ? 9.5 : 12;
              const minReadableFs = isMobile ? 6 : 7;

              const maxByH = showPercent ? availH * 0.32 : availH * 0.46;
              const maxByW = availW / Math.max(node.id.length * CHAR_RATIO, 1);

              let fs = Math.min(maxByW, maxByH, maxFs);
              let displaySymbol = node.id;

              if (fs < minReadableFs) {
                const charsAtMin = Math.floor(availW / (minReadableFs * CHAR_RATIO));
                if (charsAtMin >= 4) {
                  displaySymbol = node.id.slice(0, charsAtMin - 1) + '…';
                  const fsTrimmed = Math.min(availW / (displaySymbol.length * CHAR_RATIO), maxByH, maxFs);
                  fs = Math.max(fsTrimmed, minReadableFs);
                } else if (charsAtMin >= 2 && availH >= 16) {
                  displaySymbol = node.id.slice(0, charsAtMin);
                  fs = minReadableFs;
                } else {
                  displaySymbol = '';
                }
              }

              const percentFs = Math.min(fs * 0.85, isMobile ? 8.5 : 10);
              const cx = node.width / 2;
              const cy = node.height / 2;
              const symbolY = showPercent ? cy - fs * 0.5 : cy;
              const percentY = cy + percentFs * 0.9;
              const clipId = `hm-${node.id.replace(/[^a-z0-9]/gi, '_')}`;

              return (
                <motion.g
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.9, x: node.x, y: node.y }}
                  animate={{ opacity: 1, scale: 1, x: node.x, y: node.y }}
                  transition={{
                    type: "spring",
                    damping: 20,
                    stiffness: 300,
                    delay: (node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 20) / 100
                  }}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={node.onMouseEnter}
                  onMouseMove={node.onMouseMove}
                  onMouseLeave={node.onMouseLeave}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSymbol(node.id);
                  }}
                >
                  <defs>
                    <clipPath id={clipId}>
                      <rect
                        x={pad}
                        y={pad}
                        width={Math.max(0, node.width - pad * 2)}
                        height={Math.max(0, node.height - pad * 2)}
                        rx={2}
                        ry={2}
                      />
                    </clipPath>
                  </defs>
                  <rect
                    width={node.width}
                    height={node.height}
                    fill={node.color}
                    stroke={isSelected ? '#38bdf8' : '#0f172a'}
                    strokeWidth={isSelected ? 3 : (isMobile ? 1.5 : 2)}
                    rx={3}
                    ry={3}
                    className={isSelected ? 'filter drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]' : ''}
                  />
                  {displaySymbol && (
                    <g clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
                      <text
                        x={cx}
                        y={symbolY}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={fs}
                        fontWeight="700"
                        fill={textColor}
                        style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.6))' : 'none' }}
                      >
                        {displaySymbol}
                      </text>
                      {showPercent && (
                        <text
                          x={cx}
                          y={percentY}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={percentFs}
                          fontWeight="600"
                          fill={textColor}
                          fillOpacity={textColor === '#ffffff' ? 0.9 : 0.8}
                          style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.6))' : 'none' }}
                        >
                          {percent > 0 ? '+' : ''}{percent.toFixed(1)}%
                        </text>
                      )}
                    </g>
                  )}
                </motion.g>
              );
            }}
            enableLabel={false}
            theme={{ tooltip: { container: { background: 'transparent', color: '#fff', padding: 0, borderRadius: '8px', boxShadow: 'none' } } }}
            tooltip={({ node }) => {
              const d = (node.data as unknown) as PortfolioHoldingItem;
              const isPositive = (d.dayChangePercent ?? 0) >= 0;
              const holdingVal = d.currentValue ?? 0;
              const weight = totalValue > 0 ? ((holdingVal / totalValue) * 100).toFixed(1) : null;
              return (
                <div className="backdrop-blur-md bg-slate-900/95 border border-white/10 p-3 rounded-xl shadow-2xl min-w-[170px] pointer-events-none">
                  <div className="flex items-center justify-between gap-4 mb-1.5">
                    <span className="font-bold text-white text-sm tracking-wide">{d.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCapColor(d.marketCapCategory)}`}>
                      {d.marketCapCategory || 'Stock'}
                    </span>
                  </div>
                  {d.sector && <div className="text-[10px] text-amber-400 mb-1.5">{d.sector}</div>}
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className={`text-base font-bold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '+' : ''}{d.dayChangePercent?.toFixed(2)}%
                    </span>
                    {weight && (
                      <span className="text-[11px] text-gray-400 font-mono">
                        ({weight}%)
                      </span>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/5 flex justify-between text-[11px] text-gray-400">
                    <span>Value</span>
                    <span className="text-gray-200 font-mono">{privacyMode ? '****' : `₹${d.formattedValue}`}</span>
                  </div>
                </div>
              );
            }}
          />
        </div>

      {/* Interactive Stock Chart Modal */}
      <StockChartModal
        symbol={selectedSymbol}
        isOpen={Boolean(selectedSymbol)}
        onClose={() => setSelectedSymbol(null)}
        holding={selectedHolding}
        privacyMode={privacyMode}
      />
    </div>
  );
});
