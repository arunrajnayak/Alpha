'use client';

import { ResponsivePie } from '@nivo/pie';
import { formatNumber } from '@/lib/format';
import { SectorAllocation } from '@/lib/types';

interface SectorAllocationChartProps {
  allocations: SectorAllocation[];
  privacyMode?: boolean;
}

// Color palette for sectors
const SECTOR_COLORS: Record<string, string> = {
  'Financial Services': '#8B5CF6', // Violet
  'Engineering & Capital Goods': '#3B82F6', // Blue
  'Software Services': '#06B6D4', // Cyan
  'Chemicals': '#10B981', // Emerald
  'Healthcare': '#F43F5E', // Rose
  'FMCG': '#F59E0B', // Amber
  'Metals': '#6366F1', // Indigo
  'Real Estate': '#EC4899', // Pink
  'IT': '#14B8A6', // Teal
  'Energy': '#EF4444', // Red
  'Textiles': '#A855F7', // Purple
  'Retail': '#22C55E', // Green
  'Trading': '#0EA5E9', // Sky
  'Auto Ancillary': '#F97316', // Orange
  'Logistics': '#64748B', // Slate
  'Media & Entertainment': '#D946EF', // Fuchsia
  'Telecom': '#84CC16', // Lime
  'Consumer Durables': '#FACC15', // Yellow
  'Defence': '#78716C', // Stone
  'Unknown': '#475569', // Gray
};

// Short names for labels
const SHORT_SECTOR_NAMES: Record<string, string> = {
  'Financial Services': 'Financials',
  'Engineering & Capital Goods': 'Capex',
  'Software Services': 'Software',
  'Chemicals': 'Chem',
  'Healthcare': 'Health',
  'FMCG': 'FMCG',
  'Metals': 'Metals',
  'Real Estate': 'Realty',
  'IT': 'IT',
  'Energy': 'Energy',
  'Textiles': 'Textile',
  'Retail': 'Retail',
  'Trading': 'Trade',
  'Auto Ancillary': 'Auto',
  'Logistics': 'Logistic',
  'Media & Entertainment': 'Media',
  'Telecom': 'Telecom',
  'Consumer Durables': 'Consumer',
  'Defence': 'Defence',
  'Tourism & Hospitality': 'Tourism',
  'Education & Training': 'Education',
  'Dairy Products': 'Dairy',
};

function getSectorLabel(sector: string): string {
    return SHORT_SECTOR_NAMES[sector] || sector;
}

function getSectorColor(sector: string): string {
  return SECTOR_COLORS[sector] || `hsl(${sector.charCodeAt(0) * 10 % 360}, 60%, 50%)`;
}

export default function SectorAllocationChart({ allocations, privacyMode }: SectorAllocationChartProps) {
  if (!allocations || allocations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No sector data available
      </div>
    );
  }

  // Prepare data for pie chart
  const pieData = allocations.map(a => ({
    id: a.sector,
    label: a.sector,
    value: a.value,
    allocation: a.allocation,
    count: a.count,
    dayChangePercent: a.dayChangePercent,
    color: getSectorColor(a.sector),
  }));

  return (
    <div className="h-full w-full">
      <ResponsivePie
        data={pieData}
        margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
        innerRadius={0.4}
        padAngle={2}
        cornerRadius={8}
        activeOuterRadiusOffset={8}
        colors={{ datum: 'data.color' }}
        borderWidth={0}
        enableArcLinkLabels={false}
        arcLabelsSkipAngle={10}
        arcLabelsTextColor="#ffffff"
        arcLabel={d => {
            if (d.data.allocation > 5) {
                // Return string with \n for newline support in Nivo/AVG
                return `${getSectorLabel(d.id as string)}\n(${d.data.allocation.toFixed(0)}%)`;
            }
            return '';
        }}
        theme={{
            labels: {
                text: {
                    fontWeight: 600,
                    fontSize: 11,
                    textShadow: '0px 0px 2px rgba(0,0,0,0.4)'
                }
            }
        }}
        tooltip={({ datum }) => (
          <div className="backdrop-blur-md bg-slate-900/95 border border-white/10 px-3 py-2 rounded-lg shadow-xl">
            <div className="flex items-center gap-2 mb-1">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: datum.color }} 
              />
              <span className="font-semibold text-white text-sm">{getSectorLabel(datum.id as string)}</span>
            </div>
            <div className="space-y-0.5 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Allocation</span>
                <span className="text-white font-medium">{datum.data.allocation.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Value</span>
                <span className="text-white font-mono">
                  {privacyMode ? '****' : `₹${formatNumber(datum.value, 0, 0)}`}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Stocks</span>
                <span className="text-white">{datum.data.count}</span>
              </div>
            </div>
          </div>
        )}
        legends={[]}
        motionConfig="gentle"
      />
    </div>
  );
}
