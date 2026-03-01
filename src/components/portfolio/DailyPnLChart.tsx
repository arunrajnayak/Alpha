'use client';

import { 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ComposedChart,
  Cell,
  ReferenceLine
} from 'recharts';
import { format, subMonths, subYears, startOfYear, parseISO } from 'date-fns';
import { useState, useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar } from '@fortawesome/free-solid-svg-icons';

type DataPoint = {
  date: Date | string;
  dailyPnL: number | null;
};

type DateRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

export default function DailyPnLChart({ data }: { data: DataPoint[] }) {
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
      <div className="glass-card p-8 text-center animate-fade-in">
        <FontAwesomeIcon icon={faChartBar} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400">No data to display</p>
      </div>
    );
  }

  // Convert dates to formatted strings for chart and filter out null dailyPnL
  const chartData = filteredData
    .filter(d => d.dailyPnL !== null && d.dailyPnL !== 0)
    .map(d => ({
      ...d,
      dateStr: format(new Date(d.date), 'yyyy-MM-dd'),
      date: new Date(d.date),
      dailyPnL: d.dailyPnL ?? 0
    }));

  const handleDateRangeChange = (_event: React.MouseEvent<HTMLElement>, newRange: DateRange | null) => {
    if (newRange !== null) {
      setDateRange(newRange);
    }
  };

  // Format number in Indian style (lakhs/crores)
  const formatIndianNumber = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 10000000) {
      return `${(value / 10000000).toFixed(2)}Cr`;
    } else if (absValue >= 100000) {
      return `${(value / 100000).toFixed(2)}L`;
    } else if (absValue >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toFixed(0);
  };

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center">
                <FontAwesomeIcon icon={faChartBar} className="text-amber-400 text-lg" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Daily Gain/Loss</span>
        </div>
      
        <ToggleButtonGroup
          value={dateRange}
          exclusive
          onChange={handleDateRangeChange}
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
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                color: '#f59e0b',
                borderColor: 'rgba(245, 158, 11, 0.4)',
                '&:hover': {
                  backgroundColor: 'rgba(245, 158, 11, 0.3)',
                },
              },
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.05)',
              },
              '&.Mui-focusVisible': {
                outline: 'none !important',
                boxShadow: 'none !important',
              },
              '&:focus': {
                outline: 'none !important',
                boxShadow: 'none !important',
              }
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
      <div className="h-[300px] md:h-[400px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis 
            dataKey="dateStr" 
            stroke="#6b7280" 
            tickFormatter={(value) => format(parseISO(value), 'MMM dd')}
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
          />
          <YAxis 
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#374151' }}
            tickFormatter={(value) => formatIndianNumber(value)}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          <Bar
            dataKey="dailyPnL"
            name="Daily P/L"
            radius={[2, 2, 0, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.dailyPnL >= 0 ? '#10b981' : '#ef4444'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const value = payload[0]?.value ?? 0;
    const isPositive = value >= 0;
    
    // Format number with Indian locale
    const formatCurrency = (num: number) => {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(num);
    };

    return (
      <div className="glass-card p-2 border border-white/10 shadow-xl bg-black/80 backdrop-blur-md">
        <p className="text-[10px] text-gray-400 mb-1">{format(parseISO(label), 'MMM dd, yyyy')}</p>
        <div className="flex justify-between items-center gap-4 text-xs">
          <span className="font-medium text-gray-300">Daily P/L</span>
          <span className={`font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{formatCurrency(value)}
          </span>
        </div>
      </div>
    );
  }
  return null;
};
