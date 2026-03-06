'use client';

import { ResponsiveTreeMap } from '@nivo/treemap';
import { motion } from 'framer-motion';

interface MarketHeatmapProps {
  constituents: Array<{
    symbol: string;
    lastPrice: number;
    changePercent: number;
    volume: number;
    weight: number;
  }>;
  isMobile: boolean;
}

export default function MarketHeatmap({ constituents, isMobile }: MarketHeatmapProps) {
  if (!constituents || constituents.length === 0) return null;

  // Use index weight for sizing (higher weight = bigger tile)
  // Fall back to equal weight if no weight data
  const treeData = {
    name: 'Market',
    color: 'transparent',
    children: constituents.map(c => ({
      name: c.symbol,
      value: Math.max(c.weight, 0.01), // floor for visibility
      changePercent: c.changePercent,
      lastPrice: c.lastPrice,
    })),
  };

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 flex flex-col" style={{ height: isMobile ? '350px' : '500px' }}>
      <div className="px-5 pt-5 pb-2 shrink-0">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Market Heatmap</h3>
      </div>
      <div className="flex-1 w-full min-h-0" style={{ color: '#000' }}>
        <ResponsiveTreeMap
          data={treeData}
          identity="name"
          value="value"
          margin={{ top: 0, right: 4, bottom: 4, left: 4 }}
          labelSkipSize={isMobile ? 40 : 28}
          innerPadding={2}
          outerPadding={2}
          colors={(node) => {
            const d = node.data as { changePercent?: number };
            const p = d.changePercent;
            if (p === undefined) return 'rgba(0,0,0,0)';
            if (p >= 10) return '#059669';
            if (p >= 5) return '#10b981';
            if (p >= 3) return '#34d399';
            if (p >= 1.5) return '#6ee7b7';
            if (p > 0) return '#d1fae5';
            if (p === 0) return '#64748b';
            if (p > -1.5) return '#fee2e2';
            if (p > -3) return '#fca5a5';
            if (p > -5) return '#f87171';
            if (p > -10) return '#ef4444';
            return '#b91c1c';
          }}
          nodeOpacity={1}
          nodeComponent={({ node }) => {
            const d = node.data as { changePercent?: number; lastPrice?: number };
            const percent = d.changePercent;
            if (percent === undefined) return null;

            let textColor = '#ffffff';
            if (percent > 0 && percent < 5) textColor = '#0f172a';
            if (percent < 0 && percent > -5) textColor = '#0f172a';

            const showSymbol = node.width > 35 && node.height > 30;
            const showPercent = node.width > 45 && node.height > 45;

            return (
              <motion.g
                key={node.id}
                initial={{ opacity: 0, scale: 0.9, x: node.x, y: node.y }}
                animate={{ opacity: 1, scale: 1, x: node.x, y: node.y }}
                transition={{ type: 'spring', damping: 20, stiffness: 300, delay: (node.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 20) / 100 }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={node.onMouseEnter}
                onMouseMove={node.onMouseMove}
                onMouseLeave={node.onMouseLeave}
                onClick={node.onClick}
              >
                <rect width={node.width} height={node.height} fill={node.color} stroke="#0f172a" strokeWidth={2} rx={3} ry={3} />
                {showSymbol && (
                  <text x={node.width / 2} y={node.height / 2} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>
                    <tspan
                      x={node.width / 2}
                      dy={showPercent ? '-0.7em' : '0.3em'}
                      fontSize={Math.min(node.width / 5, isMobile ? 8 : 11)}
                      fontWeight="700"
                      fill={textColor}
                      style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}
                    >
                      {node.id}
                    </tspan>
                    {showPercent && typeof percent === 'number' && (
                      <tspan
                        x={node.width / 2}
                        dy="1.5em"
                        fontSize={Math.min(node.width / 5, isMobile ? 8 : 11)}
                        fontWeight="600"
                        fill={textColor}
                        fillOpacity={textColor === '#ffffff' ? 0.9 : 0.8}
                        style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}
                      >
                        {percent > 0 ? '+' : ''}{percent.toFixed(1)}%
                      </tspan>
                    )}
                  </text>
                )}
              </motion.g>
            );
          }}
          enableLabel={false}
          theme={{
            tooltip: {
              container: { background: 'transparent', color: '#fff', padding: 0, borderRadius: '8px', boxShadow: 'none' },
            },
          }}
          tooltip={({ node }) => {
            const d = (node.data as unknown) as { changePercent: number; lastPrice: number };
            const isPositive = d.changePercent >= 0;
            return (
              <div className="backdrop-blur-md bg-slate-900/90 border border-white/10 p-3 rounded-xl shadow-2xl min-w-[140px]">
                <div className="font-bold text-white text-sm tracking-wide mb-1">{node.id}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-gray-400 text-xs">₹{d.lastPrice?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  <span className={`text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isPositive ? '+' : ''}{d.changePercent?.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
