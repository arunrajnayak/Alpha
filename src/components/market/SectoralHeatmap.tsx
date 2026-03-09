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
            if (p >= 10) return '#059669'; // Emerald 600
            if (p >= 5) return '#10b981';  // Emerald 500
            if (p >= 3) return '#34d399';  // Emerald 400
            if (p >= 1.5) return '#6ee7b7'; // Emerald 300
            if (p > 0) return '#d1fae5';   // Emerald 100
            
            if (p === 0) return '#64748b'; // Slate 500
            
            // Loss colors (matching PortfolioHeatmap)
            if (p > -1.5) return '#fee2e2'; // Red 100
            if (p > -3) return '#fca5a5';   // Red 300
            if (p > -5) return '#f87171';   // Red 400
            if (p > -10) return '#ef4444';  // Red 500
            return '#b91c1c';                     // Red 700
          }}
          nodeOpacity={1}
          nodeComponent={({ node }) => {
            const percent = (node.data as { changePercent?: number }).changePercent;
            if (percent === undefined) return null;
            
            // Determine text color based on background brightness
            let textColor = '#ffffff';
            if (percent > 0 && percent < 5) textColor = '#0f172a'; // Dark text for < 5% gain
            if (percent < 0 && percent > -5) textColor = '#0f172a'; // Dark text for < 5% loss
            const showSymbol = node.width > 35 && node.height > 30;
            const showPercent = node.width > 45 && node.height > 45;
            
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
                onClick={node.onClick}
              >
                <rect width={node.width} height={node.height} fill={node.color} stroke="#0f172a" strokeWidth={3} rx={4} ry={4} />
                {showSymbol && (
                  <text x={node.width / 2} y={node.height / 2} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>
                    <tspan x={node.width / 2} dy={showPercent ? "-0.7em" : "0.3em"} fontSize={Math.min(node.width / 5, isMobile ? 8 : 11)} fontWeight="700" fill={textColor} style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}>{node.id}</tspan>
                    {showPercent && typeof percent === 'number' && (
                      <tspan x={node.width / 2} dy="1.5em" fontSize={Math.min(node.width / 5, isMobile ? 8 : 11)} fontWeight="600" fill={textColor} fillOpacity={textColor === '#ffffff' ? 0.9 : 0.8} style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}>{percent > 0 ? '+' : ''}{percent.toFixed(2)}%</tspan>
                    )}
                  </text>
                )}
              </motion.g>
            );
          }}
          enableLabel={false}
          theme={{ tooltip: { container: { background: 'transparent', color: '#fff', padding: 0, borderRadius: '8px', boxShadow: 'none' } } }}
          tooltip={({ node }) => {
            const d = node.data as any as { name: string; changePercent?: number; lastPrice?: number };
            const p = d.changePercent;
            
            if (p === undefined || d.lastPrice === undefined) return null;

            const isPositive = p >= 0;
            return (
              <div className="backdrop-blur-md bg-slate-900/90 border border-white/10 p-3 rounded-xl shadow-2xl min-w-[160px]">
                 <div className="flex items-center gap-4 mb-2">
                    <span className="font-bold text-white text-sm tracking-wide">{d.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-700/50 text-gray-400">Sector</span>
                 </div>
                 
                 <div className="flex items-baseline gap-1 mt-1">
                    <span className={`text-lg font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}{p.toFixed(2)}%
                    </span>
                 </div>
                 
                 <div className="mt-2 pt-2 border-t border-white/5 flex flex-col gap-0.5">
                    <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Value</span>
                        <span className="text-gray-200 font-mono">{d.lastPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                 </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
