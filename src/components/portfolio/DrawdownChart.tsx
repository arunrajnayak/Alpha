'use client';

import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  AreaChart,
  Area,
  ResponsiveContainer
} from 'recharts';
import { format, subMonths, subYears, startOfYear, parseISO } from 'date-fns';
import { useState, useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartArea } from '@fortawesome/free-solid-svg-icons';

type DataPoint = {
  date: Date | string;
  drawdown: number | null;
};

type DateRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

export default function DrawdownChart({ data }: { data: DataPoint[] }) {
  const [dateRange, setDateRange] = useState<DateRange>('ALL');

  // Filter data based on selected date range
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const now = new Date();
    let startDate: Date;
    const endDate: Date = now;

    switch (dateRange) {
      case '1M':
        startDate = subMonths(now, 1);
        break;
      case '3M':
        startDate = subMonths(now, 3);
        break;
      case '6M':
        startDate = subMonths(now, 6);
        break;
      case 'YTD':
        startDate = startOfYear(now);
        break;
      case '1Y':
        startDate = subYears(now, 1);
        break;
      case 'ALL':
      default:
        return data;
    }

    return data.filter(d => {
      const date = typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date);
      return date >= startDate && date <= endDate;
    });
  }, [data, dateRange]);

  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        No data to display
      </div>
    );
  }

  // Convert dates to formatted strings and drawdown to percentage
  const chartData = filteredData.map(d => ({
    ...d,
    dateStr: format(new Date(d.date), 'yyyy-MM-dd'),
    date: new Date(d.date),
    drawdownPercent: d.drawdown !== null ? d.drawdown * 100 : 0
  }));

  // Calculate min drawdown for Y-axis domain
  const minDrawdown = Math.min(...chartData.map(d => d.drawdownPercent));
  const yDomainMin = Math.floor(minDrawdown - 2);

  const handleDateRangeChange = (_event: React.MouseEvent<HTMLElement>, newRange: DateRange | null) => {
    if (newRange !== null) {
      setDateRange(newRange);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with Title and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/20 to-red-500/5 flex items-center justify-center">
                <FontAwesomeIcon icon={faChartArea} className="text-red-400 text-lg" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Drawdown</span>
          </div>

          <ToggleButtonGroup
            value={dateRange}
            exclusive
            onChange={handleDateRangeChange}
            size="small"
            sx={{
              '& .MuiToggleButton-root': {
                color: '#9ca3af',
                borderColor: 'rgba(255,255,255,0.1)',
                fontSize: '0.70rem',
                padding: '3px 8px',
                '&.Mui-selected': {
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#ef4444',
                  '&:hover': {
                    backgroundColor: 'rgba(239, 68, 68, 0.3)',
                  },
                },
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.05)',
                },
              },
            }}
          >
            <ToggleButton value="1M">1M</ToggleButton>
            <ToggleButton value="3M">3M</ToggleButton>
            <ToggleButton value="6M">6M</ToggleButton>
            <ToggleButton value="YTD">YTD</ToggleButton>
            <ToggleButton value="1Y">1Y</ToggleButton>
            <ToggleButton value="ALL">ALL</ToggleButton>
          </ToggleButtonGroup>
      </div>

      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis 
            dataKey="dateStr" 
            stroke="#6b7280" 
            tickFormatter={(value) => format(parseISO(value), 'MMM dd')}
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            minTickGap={30}
          />
          <YAxis 
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(value) => `${value.toFixed(0)}%`}
            domain={[yDomainMin, 0]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="drawdownPercent"
            name="Drawdown"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#drawdownGradient)"
            dot={false}
            activeDot={{ r: 5, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const drawdown = payload[0]?.value;
    
    return (
      <div className="glass-card p-2 border border-white/10 shadow-xl bg-black/80 backdrop-blur-md">
        <p className="text-[10px] text-gray-400 mb-1">{format(parseISO(label), 'MMM dd, yyyy')}</p>
        <div className="flex justify-between items-center gap-4 text-xs">
          <span className="font-medium text-red-400">Drawdown</span>
          <span className="font-mono text-red-300">{drawdown?.toFixed(2)}%</span>
        </div>
      </div>
    );
  }
  return null;
};
