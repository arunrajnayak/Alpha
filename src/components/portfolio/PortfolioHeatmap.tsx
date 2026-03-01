'use client';

import { ResponsiveTreeMap } from '@nivo/treemap';
import { formatNumber } from '@/lib/format';
import { motion } from 'framer-motion';

interface PortfolioHeatmapProps {
  data: {
    allHoldings: Array<{
      symbol: string;
      currentValue: number;
      dayChangePercent: number;
      marketCapCategory?: string;
      sector?: string;
      formattedValue: string;
    }>;
  };
  isMobile: boolean;
  privacyMode: boolean;
}

export default function PortfolioHeatmap({ data, isMobile, privacyMode }: PortfolioHeatmapProps) {
    if (!data.allHoldings || data.allHoldings.length === 0) return null;

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1 h-[400px] flex flex-col">
      <div className="px-5 pt-5 pb-0 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Portfolio Heatmap</h3>
      </div>
      <div className="flex-1 w-full min-h-0" style={{ color: '#000' }}>
        <ResponsiveTreeMap
          data={{
            name: "Portfolio",
            color: "transparent",
            children: data.allHoldings.map(h => ({ ...h, name: h.symbol, value: h.currentValue }))
          }}
          identity="name"
          value="currentValue"
          valueFormat={val => formatNumber(val, 0, 0)}
          margin={{ top: 0, right: 10, bottom: 10, left: 10 }}
          labelSkipSize={30}
          innerPadding={3}
          outerPadding={3}
          colors={(node) => {
            const d = node.data as { dayChangePercent?: number };
            const percent = d.dayChangePercent;
            if (percent === undefined) return 'rgba(0,0,0,0)';
            
            // Gain colors
            if (percent >= 10) return '#059669'; // Emerald 600 (Max > 10%)
            if (percent >= 5) return '#10b981';  // Emerald 500
            if (percent >= 3) return '#34d399';  // Emerald 400
            if (percent >= 1.5) return '#6ee7b7'; // Emerald 300
            if (percent > 0) return '#d1fae5';   // Emerald 100
            
            if (percent === 0) return '#64748b'; // Slate 500
            
            // Loss colors
            if (percent > -1.5) return '#fee2e2'; // Red 100
            if (percent > -3) return '#fca5a5';   // Red 300
            if (percent > -5) return '#f87171';   // Red 400
            if (percent > -10) return '#ef4444';  // Red 500
            return '#b91c1c';                     // Red 700 (Max > 10% loss)
          }}
          nodeOpacity={1}
          nodeComponent={({ node }) => {
            const percent = (node.data as { dayChangePercent?: number }).dayChangePercent;
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
                      <tspan x={node.width / 2} dy="1.5em" fontSize={Math.min(node.width / 5, isMobile ? 8 : 11)} fontWeight="600" fill={textColor} fillOpacity={textColor === '#ffffff' ? 0.9 : 0.8} style={{ filter: textColor === '#ffffff' ? 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))' : 'none' }}>{percent > 0 ? '+' : ''}{percent.toFixed(1)}%</tspan>
                    )}
                  </text>
                )}
              </motion.g>
            );
          }}
          enableLabel={false}
          theme={{ tooltip: { container: { background: 'transparent', color: '#fff', padding: 0, borderRadius: '8px', boxShadow: 'none' } } }}
          tooltip={({ node }) => {
            const d = (node.data as unknown) as { symbol: string; dayChangePercent: number; marketCapCategory?: string; sector?: string; formattedValue: string };
            const isPositive = d.dayChangePercent >= 0;
            const getCapColor = (cap: string | undefined) => {
              const c = (cap || '').toLowerCase();
              if (c.includes('large')) return 'bg-cyan-500/20 text-cyan-400';
              if (c.includes('mid')) return 'bg-violet-500/20 text-violet-400';
              if (c.includes('small')) return 'bg-fuchsia-500/20 text-fuchsia-400';
              if (c.includes('micro')) return 'bg-lime-500/20 text-lime-400';
              return 'bg-slate-700/50 text-gray-400';
            };
            return (
              <div className="backdrop-blur-md bg-slate-900/90 border border-white/10 p-3 rounded-xl shadow-2xl min-w-[160px]">
                <div className="flex items-center justify-between gap-4 mb-2"><span className="font-bold text-white text-sm tracking-wide">{d.symbol}</span><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCapColor(d.marketCapCategory)}`}>{d.marketCapCategory || 'Stock'}</span></div>
                {d.sector && <div className="text-[10px] text-amber-400 mb-1.5">{d.sector}</div>}
                <div className="flex items-baseline gap-1 mt-1"><span className={`text-lg font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{isPositive ? '+' : ''}{d.dayChangePercent?.toFixed(2)}%</span></div>
                <div className="mt-2 pt-2 border-t border-white/5 flex flex-col gap-0.5"><div className="flex justify-between text-[10px] text-gray-400"><span>Value</span><span className="text-gray-200 font-mono">{privacyMode ? '****' : `₹${d.formattedValue}`}</span></div></div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
