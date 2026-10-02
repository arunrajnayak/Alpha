'use client';

import { useState, useMemo } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { formatNumber } from '@/lib/format';
import { SectorAllocation } from '@/lib/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSort, faSortUp, faSortDown } from '@fortawesome/free-solid-svg-icons';

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

type SortKey = 'allocation' | 'count' | 'sector';
type SortDirection = 'asc' | 'desc';

export default function SectorAllocationChart({ allocations, privacyMode }: SectorAllocationChartProps) {
  const [sortKey, setSortKey] = useState<SortKey>('allocation');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'sector' ? 'asc' : 'desc');
    }
  };

  const sortedAllocations = useMemo(() => {
    if (!allocations) return [];
    return [...allocations].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'allocation') {
        cmp = a.allocation - b.allocation;
      } else if (sortKey === 'count') {
        cmp = a.count - b.count;
      } else if (sortKey === 'sector') {
        cmp = a.sector.localeCompare(b.sector);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [allocations, sortKey, sortDirection]);

  // Prepare data for pie chart (always ordered by allocation descending)
  const pieData = useMemo(() => {
    if (!allocations) return [];
    return [...allocations]
      .sort((a, b) => b.allocation - a.allocation)
      .map(a => ({
        id: a.sector,
        label: a.sector,
        value: a.value,
        allocation: a.allocation,
        count: a.count,
        dayChangePercent: a.dayChangePercent,
        color: getSectorColor(a.sector),
      }));
  }, [allocations]);

  if (!allocations || allocations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No sector data available
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full">
      {/* Donut Chart (Left Side) */}
      <div className="w-full lg:col-span-6 h-[380px] lg:h-[400px] relative">
        <ResponsivePie
          data={pieData}
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          innerRadius={0.45}
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
              return `${getSectorLabel(d.id as string)}\n(${d.data.allocation.toFixed(0)}%)`;
            }
            return '';
          }}
          theme={{
            labels: {
              text: {
                fontWeight: 600,
                fontSize: 11,
                textShadow: '0px 0px 2px rgba(0,0,0,0.4)',
              },
            },
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

      {/* Table (Right Side) */}
      <div className="w-full lg:col-span-6 flex flex-col h-[380px] lg:h-[400px] rounded-xl border border-white/5 bg-slate-950/40 overflow-hidden shadow-inner">
        <div className="overflow-y-auto flex-1 custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-md border-b border-white/10 text-gray-400 text-[11px] uppercase tracking-wider select-none">
              <tr>
                <th
                  scope="col"
                  onClick={() => handleSort('sector')}
                  className="py-3 px-3.5 font-semibold cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Sector</span>
                    {sortKey === 'sector' ? (
                      <FontAwesomeIcon icon={sortDirection === 'asc' ? faSortUp : faSortDown} className="text-blue-400 text-xs" />
                    ) : (
                      <FontAwesomeIcon icon={faSort} className="text-gray-600 text-[10px]" />
                    )}
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => handleSort('count')}
                  className="py-3 px-3 font-semibold text-center cursor-pointer hover:text-white transition-colors w-20"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Stocks</span>
                    {sortKey === 'count' ? (
                      <FontAwesomeIcon icon={sortDirection === 'asc' ? faSortUp : faSortDown} className="text-blue-400 text-xs" />
                    ) : (
                      <FontAwesomeIcon icon={faSort} className="text-gray-600 text-[10px]" />
                    )}
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => handleSort('allocation')}
                  className="py-3 px-3.5 font-semibold text-right cursor-pointer hover:text-white transition-colors w-44 sm:w-56"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Weight</span>
                    {sortKey === 'allocation' ? (
                      <FontAwesomeIcon icon={sortDirection === 'asc' ? faSortUp : faSortDown} className="text-blue-400 text-xs" />
                    ) : (
                      <FontAwesomeIcon icon={faSort} className="text-gray-600 text-[10px]" />
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedAllocations.map(a => {
                const color = getSectorColor(a.sector);
                return (
                  <tr key={a.sector} className="hover:bg-white/[0.04] transition-colors group">
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm transition-transform group-hover:scale-125"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-gray-200 font-medium truncate" title={a.sector}>
                          {a.sector}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-300 font-mono">
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/5">
                        {a.count}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-white font-semibold font-mono">
                          {a.allocation.toFixed(1)}%
                        </span>
                        <div className="w-20 sm:w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0 hidden sm:block">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(100, a.allocation)}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
