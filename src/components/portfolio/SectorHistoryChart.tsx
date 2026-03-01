
'use client';

import { useMemo, useState } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { format, subMonths, subYears, isAfter } from 'date-fns';
import { SectorAllocation } from '@/lib/types';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartPie } from '@fortawesome/free-solid-svg-icons';

// Color palette for sectors (Consistent with SectorAllocationChart)
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
  
function getSectorColor(sector: string): string {
    return SECTOR_COLORS[sector] || `hsl(${sector.charCodeAt(0) * 10 % 360}, 60%, 50%)`;
}

const SECTOR_DISPLAY_NAMES: Record<string, string> = {
    'Engineering & Capital Goods': 'Capex',
    'Financial Services': 'Financials',
    'Software Services': 'Software',
    'Media & Entertainment': 'Media',
    'Tourism & Hospitality': 'Tourism',
    'Education & Training': 'Education',
    'Consumer Durables': 'Consumer',
    'Dairy Products': 'Dairy',
};

interface WeeklyPortfolioSnapshot {
    date: Date;
    sectorAllocation: string | null; // JSON string
}

interface Props {
    data: WeeklyPortfolioSnapshot[];
}

type DateRange = '3M' | '6M' | '1Y' | 'ALL';

export default function SectorHistoryChart({ data }: Props) {
    const [dateRange, setDateRange] = useState<DateRange>('ALL');
    const [hoveredSector, setHoveredSector] = useState<string | null>(null);

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return { data: [], sectors: [], topSector: null };

        // 1. Sort base data chronologically first (oldest -> newest)
        const sortedSnapshots = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // 2. Filter based on date range
        const now = new Date();
        let startDate: Date | null = null;
        if (dateRange === '3M') startDate = subMonths(now, 3);
        else if (dateRange === '6M') startDate = subMonths(now, 6);
        else if (dateRange === '1Y') startDate = subYears(now, 1);

        const filtered = startDate 
            ? sortedSnapshots.filter(d => isAfter(new Date(d.date), startDate!))
            : sortedSnapshots;

        if (filtered.length === 0) return { data: [], sectors: [], topSector: null };

        // 3. Extract ALL unique sectors from the filtered range AND calculate volumes for sorting
        const allSectors = new Set<string>();
        const sectorVolumes = new Map<string, number>();

        // Helper to parse allocations safely
        const parseAllocations = (json: string | null): SectorAllocation[] => {
            if (!json) return [];
            try {
                return JSON.parse(json);
            } catch {
                return [];
            }
        };

        filtered.forEach(d => {
            const allocs = parseAllocations(d.sectorAllocation);
            allocs.forEach(a => {
                if (a.sector) {
                    allSectors.add(a.sector);
                    // Accumulate volume for sorting (Allocation % is essentially relative volume here)
                    const currentVol = sectorVolumes.get(a.sector) || 0;
                    sectorVolumes.set(a.sector, currentVol + a.allocation);
                }
            });
        });

        // Sort sectors by Total Volume (Descending) so biggest sectors are at bottom of stack
        const sectorList = Array.from(allSectors).sort((a, b) => {
            const volA = sectorVolumes.get(a) || 0;
            const volB = sectorVolumes.get(b) || 0;
            return volB - volA;
        });

        // 4. Transform into dense matrix for Recharts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processedData: any[] = filtered.map(d => {
            const allocs = parseAllocations(d.sectorAllocation);
            // Create a lookup for this snapshot
            const allocMap = new Map<string, number>();
            allocs.forEach(a => {
                if (a.sector) allocMap.set(a.sector, a.allocation);
            });

            // Build item with ALL sectors present (default to 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item: any = {
                date: new Date(d.date).toISOString(), // Use simple string for keys if needed, but we rely on index usually
                displayDate: format(new Date(d.date), 'dd MMM yy'),
                fullDate: new Date(d.date).getTime(),
            };

            sectorList.forEach(sector => {
                item[sector] = allocMap.get(sector) || 0;
            });

            return item;
        });

        // 5. Determine Top Sector (from LATEST entry) for highlighting
        let topSector: string | null = null;
        if (processedData.length > 0) {
            const lastEntry = processedData[processedData.length - 1];
            let maxAlloc = -1;
            sectorList.forEach(s => {
                const val = Number(lastEntry[s]) || 0;
                if (val > maxAlloc) {
                    maxAlloc = val;
                    topSector = s;
                }
            });
        }

        return { data: processedData, sectors: sectorList, topSector };
    }, [data, dateRange]);

    const handleRangeChange = (_: React.MouseEvent<HTMLElement>, newRange: DateRange | null) => {
        if (newRange) setDateRange(newRange);
    };

    const safeId = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_');

    if (chartData.data.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center min-h-[400px]">
                 <div className="text-center">
                    <div className="w-12 h-12 rounded-xl bg-slate-800/50 flex items-center justify-center mx-auto mb-3">
                        <FontAwesomeIcon icon={faChartPie} className="text-slate-600 text-xl" />
                    </div>
                    <p className="text-slate-500 text-sm">No sector history available</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center">
                        <FontAwesomeIcon icon={faChartPie} className="text-indigo-400 text-lg" />
                    </div>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Sector Allocation History</span>
                </div>

                <ToggleButtonGroup
                    value={dateRange}
                    exclusive
                    onChange={handleRangeChange}
                    size="small"
                    sx={{
                        height: '32px',
                        backgroundColor: 'rgba(15, 23, 42, 0.4)',
                        '& .MuiToggleButton-root': {
                            color: '#9ca3af',
                            border: '1px solid rgba(255,255,255,0.1)',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '0 12px',
                            textTransform: 'none',
                            '&.Mui-selected': {
                                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                                color: '#818cf8',
                                borderColor: 'rgba(99, 102, 241, 0.4)',
                            },
                        },
                    }}
                >
                    <ToggleButton value="3M">3M</ToggleButton>
                    <ToggleButton value="6M">6M</ToggleButton>
                    <ToggleButton value="1Y">1Y</ToggleButton>
                    <ToggleButton value="ALL">ALL</ToggleButton>
                </ToggleButtonGroup>
            </div>

            <div className="w-full h-[300px] md:h-[500px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart
                        data={chartData.data}
                        margin={{ top: 10, right: 5, left: -10, bottom: 0 }}
                        stackOffset="expand"
                    >
                        <defs>
                            {chartData.sectors.map((sector) => {
                                const isTop = sector === chartData.topSector;
                                const gradId = `color-${safeId(sector)}`;
                                const sectorColor = getSectorColor(sector);
                                return (
                                    <linearGradient key={`grad-${sector}`} id={gradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={sectorColor} stopOpacity={isTop ? 0.9 : 0.7}/>
                                        <stop offset="95%" stopColor={sectorColor} stopOpacity={0.1}/>
                                    </linearGradient>
                                );
                            })}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis 
                            dataKey="displayDate" 
                            stroke="#94a3b8" 
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={30}
                        />
                        <YAxis 
                            stroke="#94a3b8"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 1]}
                            ticks={[0, 0.25, 0.5, 0.75, 1]}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        {chartData.sectors.map((sector) => {
                            const gradId = `color-${safeId(sector)}`;
                            const sectorColor = getSectorColor(sector);
                            const isHovered = hoveredSector === sector;
                            const isDimmed = hoveredSector && !isHovered;

                            return (
                                <Area
                                    key={sector}
                                    type="monotone"
                                    dataKey={sector}
                                    stackId="1"
                                    stroke={sectorColor}
                                    fill={`url(#${gradId})`}
                                    strokeWidth={isHovered ? 2 : 0}
                                    fillOpacity={isDimmed ? 0.1 : 1}
                                    strokeOpacity={isDimmed ? 0.2 : 1}
                                    activeDot={{ r: 4 }}
                                />
                            );
                        })}
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Interactive Legend */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 justify-center px-4">
                {chartData.sectors.map((sector) => {
                    const displayName = SECTOR_DISPLAY_NAMES[sector] || sector;
                    const color = getSectorColor(sector);
                    const isHovered = hoveredSector === sector;
                    const isDimmed = hoveredSector && !isHovered;

                    return (
                        <button
                            key={sector}
                            onMouseEnter={() => setHoveredSector(sector)}
                            onMouseLeave={() => setHoveredSector(null)}
                            className={`
                                flex items-center gap-2 py-1 transition-all duration-200 cursor-pointer
                                ${isHovered 
                                    ? 'scale-105 opacity-100' 
                                    : isDimmed 
                                        ? 'opacity-30 blur-[0.5px]' 
                                        : 'opacity-70 hover:opacity-100'}
                            `}
                        >
                            <span 
                                className="w-6 h-1.5 rounded-full shadow-sm" 
                                style={{ backgroundColor: color }} 
                            />
                            <span className="text-[11px] font-medium tracking-wide text-gray-300">
                                {displayName}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface CustomTooltipProps {
    active?: boolean;

    payload?: Array<{
      name: string;
      value: number | string;
      color: string;
    }>;
    label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
      // Since we use stackOffset="expand", values are normalized 0-1. 
      // We might want to show original percentage? The chart data input has real values (0-100ish),
      // but 'expand' normalizes them. Recharts payload usually contains the *normalized* value for rendering,
      // but also the original data in `payload[i].payload`.
      // Actually, when using `stackOffset="expand"`, the `value` passed to tooltip is the normalized value (0-1).
      // If we want to show true percentages (0-100), we should look at the raw data item if possible, or just multiply by 100 
      // IF the source data didn't already sum to 100.
      
      // However, our source data IS percentages (0-100). 'expand' treats them as weights.
      // So checks: 
      // If source sums to 90, expand makes it 1. 
      // We want to show what portion of the portfolio it is. 
      // Assuming source data properly sums to ~100, (value * 100) is roughly correct relative percentage.
      
      const filteredPayload = payload
        .filter((entry) => (Number(entry.value) || 0) > 0.005) // Hide very small entries (< 0.5%)
        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  
      if (filteredPayload.length === 0) return null;
  
      return (
        <div className="glass-card p-3 border border-white/10 shadow-xl bg-slate-950/90 backdrop-blur-md min-w-[180px]">
          <p className="text-xs font-bold text-gray-400 mb-2 border-b border-white/10 pb-1">{label}</p>
          <div className="flex flex-col gap-1.5">
            {filteredPayload.map((entry, index) => {
              const displayName = SECTOR_DISPLAY_NAMES[entry.name] || entry.name;
              return (
                <div key={index} className="flex justify-between items-center gap-4 text-[11px]">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getSectorColor(entry.name) }} />
                    <span className="text-gray-300 truncate max-w-[100px]">{displayName}</span>
                  </div>

                  <span className="font-mono text-gray-100">{(Number(entry.value)).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };
