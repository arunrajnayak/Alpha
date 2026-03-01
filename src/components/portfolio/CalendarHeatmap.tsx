'use client';

import React, { useMemo } from 'react';
import { format, subYears, eachDayOfInterval, getMonth, getDay, startOfYear, endOfYear, getYear } from 'date-fns';
import { ToggleButton, ToggleButtonGroup, CircularProgress } from '@mui/material';
import { formatCurrency } from '@/lib/format';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';

type SnapshotDataPoint = {
  date: Date | string;
  dailyPnL?: number | null;
  dailyReturn?: number | null;
};

interface PortfolioHeatmapProps {
  data: SnapshotDataPoint[];
}



// Format percentage for tooltip
function formatPercentage(val: number): string {
  const percentage = val * 100;
  const sign = percentage >= 0 ? '+' : '';
  return `${sign}${percentage.toFixed(2)}%`;
}

// Get color based on P&L value and magnitude using continuous relative shading
function getColor(value: number, maxAbsValue: number): string {
  if (Math.abs(value) < 0.01) return 'rgba(75, 85, 99, 0.3)'; // Empty / No Trade
  
  // Calculate ratio (0 to 1) based on max value in range
  const ratio = Math.min(Math.abs(value) / maxAbsValue, 1);
  
  if (value > 0) {
    // Gains: Interpolate between Emerald 200 and Emerald 700
    // Emerald 200: 167, 243, 208
    // Emerald 700: 4, 120, 87
    const r = Math.round(167 + (4 - 167) * ratio);
    const g = Math.round(243 + (120 - 243) * ratio);
    const b = Math.round(208 + (87 - 208) * ratio);
    
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Losses: Interpolate between Red 200 and Red 700
    // Red 200: 254, 202, 202
    // Red 700: 185, 28, 28
    const r = Math.round(254 + (185 - 254) * ratio);
    const g = Math.round(202 + (28 - 202) * ratio);
    const b = Math.round(202 + (28 - 202) * ratio);
    
    return `rgb(${r}, ${g}, ${b})`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL_SIZE = 16;
const CELL_GAP = 2;
const MONTH_GAP = 6; // Gap between months

export default function PortfolioHeatmap({ data }: PortfolioHeatmapProps) {
  const [selectedYear, setSelectedYear] = React.useState<string>('last_1_year');
  const [endDate, setEndDate] = React.useState<Date | null>(null);
  const [tooltip, setTooltip] = React.useState<{ 
    x: number; 
    y: number; 
    visible: boolean;
    data: { date: Date, pnl: number, ret: number } | null 
  }>({
    x: 0,
    y: 0,
    visible: false,
    data: null
  });

  React.useEffect(() => {
    setEndDate(new Date());
  }, []);

  // Calculate available years from data
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    data.forEach(d => {
      years.add(getYear(new Date(d.date)).toString());
    });
    // Sort years descending
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [data]);

  // Calculate date range based on selection
  const { startDate, endDate: calculatedEndDate } = useMemo(() => {
    // If we haven't mounted yet (endDate is null), use a stable reference or return early
    // But hooks must run. 
    // We can default to a stable date for initial render if needed, but returning null later is safer.
    const referenceDate = endDate || new Date(); 
    
    if (selectedYear === 'last_1_year') {
      return {
        startDate: subYears(referenceDate, 1),
        endDate: referenceDate
      };
    } else {
      const year = parseInt(selectedYear);
      return {
        startDate: startOfYear(new Date(year, 0, 1)),
        endDate: endOfYear(new Date(year, 0, 1))
      };
    }
  }, [selectedYear, endDate]);

  // Build a lookup map for P&L by date
  const dailyDataMap = useMemo(() => {
    const map = new Map<string, { pnl: number; ret: number }>();
    data.forEach(d => {
      const dateStr = format(new Date(d.date), 'yyyy-MM-dd');
      const pnl = d.dailyPnL ?? 0;
      const ret = d.dailyReturn ?? 0;
      map.set(dateStr, { pnl, ret });
    });
    return map;
  }, [data]);

  // Calculate max absolute value for color scaling (globally or per view? usually per view is better contrast)
  const maxAbsValue = useMemo(() => {
    let max = 0;
    // We only consider data within the current view for scaling to maximize contrast
    const start = startDate.getTime();
    const end = calculatedEndDate.getTime();
    
    data.forEach(d => {
      const dTime = new Date(d.date).getTime();
      if (dTime >= start && dTime <= end) {
        max = Math.max(max, Math.abs(d.dailyPnL ?? 0));
      }
    });
    return max || 1;
  }, [data, startDate, calculatedEndDate]);

  // Group days by month, then by week within each month
  const monthData = useMemo(() => {
    // Filter days to be within the range
    const allDays = eachDayOfInterval({ start: startDate, end: calculatedEndDate });
    const months: { month: number; year: number; weeks: (Date | null)[][] }[] = [];
    
    let currentMonth = -1;
    let currentYear = -1;
    let currentMonthWeeks: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = [];
    
    allDays.forEach((day, index) => {
      const month = getMonth(day);
      const year = day.getFullYear();
      const dayOfWeek = getDay(day); // 0 = Sunday, 1 = Monday, etc.
      
      // Convert to Monday = 0, Sunday = 6
      const adjustedDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      
      // Check if we're starting a new month
      if (month !== currentMonth || year !== currentYear) {
        // Save previous month if exists
        if (currentMonthWeeks.length > 0 || currentWeek.length > 0) {
          if (currentWeek.length > 0) {
            // Pad the week to 7 days
            while (currentWeek.length < 7) {
              currentWeek.push(null);
            }
            currentMonthWeeks.push(currentWeek);
          }
          months.push({ month: currentMonth, year: currentYear, weeks: currentMonthWeeks });
        }
        
        // Start new month
        currentMonth = month;
        currentYear = year;
        currentMonthWeeks = [];
        currentWeek = [];
        
        // Pad the start of the first week
        for (let i = 0; i < adjustedDayOfWeek; i++) {
          currentWeek.push(null);
        }
      }
      
      // Check if we need to start a new week
      if (adjustedDayOfWeek === 0 && currentWeek.length > 0) {
        while (currentWeek.length < 7) {
          currentWeek.push(null);
        }
        currentMonthWeeks.push(currentWeek);
        currentWeek = [];
      }
      
      currentWeek.push(day);
      
      // Handle last day
      if (index === allDays.length - 1) {
        while (currentWeek.length < 7) {
          currentWeek.push(null);
        }
        currentMonthWeeks.push(currentWeek);
        months.push({ month: currentMonth, year: currentYear, weeks: currentMonthWeeks });
      }
    });
    
    return months;
  }, [startDate, calculatedEndDate]);

  if (!endDate) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in min-h-[200px] flex flex-col items-center justify-center">
        <CircularProgress size={30} className="mb-4 text-gray-500" />
        <p className="text-gray-400 text-sm">Initializing...</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in min-h-[200px] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
            <FontAwesomeIcon icon={faCalendarDays} className="text-2xl text-gray-600" />
        </div>
        <p className="text-gray-300 font-medium">No performance data available</p>
        <p className="text-gray-500 text-xs mt-1">
            add trades to see your portfolio heatmap
        </p>
      </div>
    );
  }

  // Calculate total width
  let xOffset = 30; // Space for weekday labels
  const monthPositions: { month: number; year: number; x: number }[] = [];
  
  monthData.forEach((monthObj) => {
    monthPositions.push({ month: monthObj.month, year: monthObj.year, x: xOffset });
    xOffset += monthObj.weeks.length * (CELL_SIZE + CELL_GAP) + MONTH_GAP;
  });
  
  const totalWidth = xOffset;
  const totalHeight = 7 * (CELL_SIZE + CELL_GAP) + 25; // 7 days + month labels

  const handleYearChange = (_: React.MouseEvent<HTMLElement>, newYear: string | null) => {
    if (newYear) {
      setSelectedYear(newYear);
    }
  };

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center">
                <FontAwesomeIcon icon={faCalendarDays} className="text-amber-400 text-lg" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Performance Heatmap</span>
        </div>

        <div className="flex justify-end items-center overflow-x-auto pb-2 w-full md:w-auto">
        {availableYears.length > 0 && (
          <div className="ml-auto min-w-max">
            <ToggleButtonGroup
              value={selectedYear}
              exclusive
              onChange={handleYearChange}
              size="small"
              sx={{
                '& .MuiToggleButton-root': {
                  color: '#9ca3af',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  padding: '4px 12px',
                  fontSize: '0.75rem',
                  textTransform: 'none',
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: '#3b82f6',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                  },
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  },
                },
              }}
            >
              <ToggleButton value="last_1_year">Last 1 Year</ToggleButton>
              {availableYears.map(year => (
                <ToggleButton key={year} value={year}>{year}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>
        )}
      </div>
    </div>

      <div className="heatmap-container w-full overflow-x-auto mt-4">
        <svg 
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`} 
          className="heatmap-svg h-auto"
        >
          {/* Month labels */}
          {monthPositions.map((pos, idx) => (
            <text
              key={`month-${idx}`}
              x={pos.x}
              y={12}
              className="fill-gray-400 text-[9px] md:text-[11px]"
            >
              {MONTHS[pos.month]}
            </text>
          ))}
          
          {/* Weekday labels */}
          {WEEKDAYS.map((day, dayIdx) => (
            <text
              key={`weekday-${dayIdx}`}
              x={0}
              y={25 + dayIdx * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2 + 4}
              className="fill-gray-500 text-[8px] md:text-[9px]"
            >
              {day}
            </text>
          ))}
          
          {/* Cells */}
          {monthData.map((monthObj, monthIdx) => {
            const monthStartX = monthPositions[monthIdx].x;
            
            return monthObj.weeks.map((week, weekIdx) => (
              <g key={`month-${monthIdx}-week-${weekIdx}`}>
                {week.map((day, dayIdx) => {
                  if (!day) return null;
                  
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dataPoint = dailyDataMap.get(dateStr);
                  const pnl = dataPoint?.pnl ?? 0;
                  const ret = dataPoint?.ret ?? 0;
                  const color = getColor(pnl, maxAbsValue);
                  
                  // Calculate a staggered delay based on position
                  // monthIdx * 5 (weeks approx) + weekIdx gives a rough linear progression
                  const delayIndex = (monthIdx * 4) + weekIdx + (dayIdx * 0.2); 
                  const animationDelay = `${delayIndex * 0.03}s`;

                  return (
                    <rect
                      key={`${dateStr}-${selectedYear}`} // Force re-render on year change for animation
                      x={monthStartX + weekIdx * (CELL_SIZE + CELL_GAP)}
                      y={25 + dayIdx * (CELL_SIZE + CELL_GAP)}
                      width={CELL_SIZE}
                      height={CELL_SIZE}
                      rx={2}
                      fill={color}
                      className="heatmap-cell"
                      style={{ 
                        animation: `scaleIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`,
                        animationDelay,
                        opacity: 0 // Start invisible
                      }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        // Removed DOM manipulation avoiding flicker
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          visible: true,
                          data: {
                             date: day,
                             pnl,
                             ret
                          }
                        });
                      }}
                      onMouseLeave={() => {
                        setTooltip(prev => ({ ...prev, visible: false }));
                      }}
                    />
                  );
                })}
              </g>
            ));
          })}
        </svg>
      </div>

      {/* Legend Removed as requested */}
      {/* Custom Tooltip - Rendered in Portal to avoid transform context issues */}
      {tooltip.visible && tooltip.data && typeof document !== 'undefined' && createPortal(
        <div 
          className="heatmap-tooltip flex flex-col gap-1 min-w-[140px] shadow-xl border border-white/10"
          style={{ 
            left: tooltip.x, 
            top: tooltip.y,
            background: 'rgba(10, 15, 26, 0.95)'
          }}
        >
          <div className="text-gray-400 text-xs font-medium border-b border-white/10 pb-1 mb-1">
            {format(tooltip.data.date, 'dd MMM yyyy')}
          </div>
          {Math.abs(tooltip.data.pnl) < 1 ? (
             <div className="text-center text-gray-500 text-sm py-1">No Trade</div>
          ) : (
             <>
                <div className={`font-bold text-sm ${tooltip.data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tooltip.data.pnl >= 0 ? '+' : ''}{formatCurrency(tooltip.data.pnl)}
                </div>
                <div className={`text-xs ${tooltip.data.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                    {formatPercentage(tooltip.data.ret)}
                </div>
             </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
