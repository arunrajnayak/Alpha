'use client';

import { ResponsiveTreeMap } from '@nivo/treemap';
import { motion } from 'framer-motion';
import { useMemo } from 'react';

interface IndexSummary {
  name: string;
  shortName: string;
  category: string;
  value: number;
  change: number;
  changePercent: number;
}

interface SectoralHeatmapProps {
  indices: IndexSummary[];
  isMobile: boolean;
}

export default function SectoralHeatmap({ indices, isMobile }: SectoralHeatmapProps) {
  // Filter for sectoral indices that actually have data
  const sectoralIndices = useMemo(() => {
    return indices
      .filter((c) => c.category === 'sectoral' && c.value > 0)
      // Remove NIFTY prefix for cleaner labels
      .map((c) => ({
        name: c.shortName || c.name.replace(/^NIFTY\s+/i, ''),
        value: Math.max(1, Math.abs(c.changePercent)), // Provide a default positive area weight. We can also use index value if preferred, but abs(changePercent) or equal weight are common. Fall back to 1 if change is 0.
        changePercent: c.changePercent,
        lastPrice: c.value,
      }))
      // Sort so highest gainers appear first in the map
      .sort((a, b) => b.changePercent - a.changePercent);
  }, [indices]);

  if (!sectoralIndices || sectoralIndices.length === 0) return null;

  const treeData = {
    name: 'Sectors',
    color: 'transparent',
    children: sectoralIndices,
  };

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 flex flex-col" style={{ height: isMobile ? '350px' : '400px' }}>
      <div className="px-5 pt-5 pb-2 shrink-0">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Sectoral Heatmap</h3>
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
            if (p >= 3) return '#059669';
            if (p >= 1.5) return '#10b981';
            if (p > 0) return '#34d399';
            if (p === 0) return '#64748b';
            if (p > -1.5) return '#fca5a5';
            if (p > -3) return '#f87171';
            return '#ef4444';
          }}
          nodeOpacity={1}
          borderWidth={0}
          label={(node) => {
            const d = node.data as any as { name: string; changePercent?: number };
            if (d.changePercent === undefined) return d.name;
            const sign = d.changePercent >= 0 ? '+' : '';
            return `${d.name}\n${sign}${d.changePercent.toFixed(2)}%`;
          }}
          labelTextColor="#ffffff"
          orientLabel={false}
          theme={{
            labels: {
              text: {
                fontSize: isMobile ? 10 : 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                whiteSpace: 'pre-wrap',
                textShadow: '0px 1px 2px rgba(0,0,0,0.6)',
              },
            },
            tooltip: {
              container: {
                background: 'rgba(15, 23, 42, 0.9)',
                color: '#fff',
                fontSize: '12px',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255,255,255,0.1)',
                backdropFilter: 'blur(8px)',
              },
            },
          }}
          tooltip={({ node }) => {
            const d = node.data as any as { name: string; changePercent?: number; lastPrice?: number };
            const p = d.changePercent;
            
            if (p === undefined || d.lastPrice === undefined) return null;

            const sign = p >= 0 ? '+' : '';
            const color = p >= 0 ? 'text-emerald-400' : 'text-rose-400';
            return (
              <div className="px-3 py-2 flex flex-col gap-1">
                <span className="font-bold text-gray-200">{d.name}</span>
                <span className="text-gray-400">
                  Val: <span className="text-white font-medium">{d.lastPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </span>
                <span className={color}>
                  {sign}{p.toFixed(2)}%
                </span>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
