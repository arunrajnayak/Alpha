'use client';

import { 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts';
import { format, subMonths, subYears, startOfYear, parseISO, startOfDay, endOfDay } from 'date-fns';
import { useState, useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';

type DataPoint = {
  date: Date | string;
  portfolioNAV: number;
  niftyNAV: number | null;
  nifty500Momentum50NAV: number | null;
  niftyMidcap100NAV: number | null;
  niftySmallcap250NAV: number | null;
  niftyMicrocap250NAV: number | null;
  investedCapital: number;
  totalEquity: number;
};

type DateRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL' | 'CUSTOM';

export default function EquityCurve({ data }: { data: DataPoint[] }) {
  const [visible, setVisible] = useState<{ [key: string]: boolean }>({
    portfolioNAV: true,
    niftyNAV: true,
    nifty500Momentum50NAV: true,
    niftyMidcap100NAV: false,
    niftySmallcap250NAV: false,
    niftyMicrocap250NAV: false,
  });
  const [dateRange, setDateRange] = useState<DateRange>('ALL');
  const [customStart, setCustomStart] = useState<Date | null>(subYears(new Date(), 1));
  const [customEnd, setCustomEnd] = useState<Date | null>(new Date());
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);

  // Filter data based on selected date range
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

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
      case 'CUSTOM':
        if (customStart) {
            startDate = startOfDay(customStart);
        } else {
            return data; // Fallback to all data if custom start undefined
        }
        if (customEnd) {
            endDate = endOfDay(customEnd);
        }
        break;
      case 'ALL':
      default:
        return data;
    }

    const rawFiltered = data.filter(d => {
      const date = typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date);
      return date >= startDate && date <= endDate;
    });

    if (rawFiltered.length === 0) return [];

    // Rebase to 100 at start
    const basePortfolio = rawFiltered[0]?.portfolioNAV;
    
    // Better strategy for indices: Find the first non-null value in the filtered set used as base.
    const firstNifty = rawFiltered.find(d => d.niftyNAV !== null)?.niftyNAV;
    const firstMomentum = rawFiltered.find(d => d.nifty500Momentum50NAV !== null)?.nifty500Momentum50NAV;
    const firstMidcap = rawFiltered.find(d => d.niftyMidcap100NAV !== null)?.niftyMidcap100NAV;
    const firstSmallcap = rawFiltered.find(d => d.niftySmallcap250NAV !== null)?.niftySmallcap250NAV;
    const firstMicrocap = rawFiltered.find(d => d.niftyMicrocap250NAV !== null)?.niftyMicrocap250NAV;

    return rawFiltered.map(d => ({
        ...d,
        portfolioNAV: basePortfolio ? (d.portfolioNAV / basePortfolio) * 100 : 100,
        niftyNAV: d.niftyNAV && firstNifty ? (d.niftyNAV / firstNifty) * 100 : (d.niftyNAV === null ? null : 100),
        nifty500Momentum50NAV: d.nifty500Momentum50NAV && firstMomentum ? (d.nifty500Momentum50NAV / firstMomentum) * 100 : (d.nifty500Momentum50NAV === null ? null : 100),
        niftyMidcap100NAV: d.niftyMidcap100NAV && firstMidcap ? (d.niftyMidcap100NAV / firstMidcap) * 100 : (d.niftyMidcap100NAV === null ? null : 100),
        niftySmallcap250NAV: d.niftySmallcap250NAV && firstSmallcap ? (d.niftySmallcap250NAV / firstSmallcap) * 100 : (d.niftySmallcap250NAV === null ? null : 100),
        niftyMicrocap250NAV: d.niftyMicrocap250NAV && firstMicrocap ? (d.niftyMicrocap250NAV / firstMicrocap) * 100 : (d.niftyMicrocap250NAV === null ? null : 100),
    }));
  }, [data, dateRange, customStart, customEnd]);

  if (!data || data.length === 0) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in">
        <FontAwesomeIcon icon={faChartLine} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400">No data to display</p>
      </div>
    );
  }

  // Convert dates to formatted strings for chart
  const chartData = filteredData.map(d => ({
    ...d,
    dateStr: format(new Date(d.date), 'yyyy-MM-dd'),
    date: new Date(d.date)
  }));

  // Calculate global minimum for Y-axis domain based on visible series
  let globalMin = Infinity;
  chartData.forEach(d => {
    if (visible.portfolioNAV && d.portfolioNAV !== null) globalMin = Math.min(globalMin, d.portfolioNAV);
    if (visible.niftyNAV && d.niftyNAV !== null) globalMin = Math.min(globalMin, d.niftyNAV);
    if (visible.nifty500Momentum50NAV && d.nifty500Momentum50NAV !== null) globalMin = Math.min(globalMin, d.nifty500Momentum50NAV);
    if (visible.niftyMidcap100NAV && d.niftyMidcap100NAV !== null) globalMin = Math.min(globalMin, d.niftyMidcap100NAV);
    if (visible.niftySmallcap250NAV && d.niftySmallcap250NAV !== null) globalMin = Math.min(globalMin, d.niftySmallcap250NAV);
    if (visible.niftyMicrocap250NAV && d.niftyMicrocap250NAV !== null) globalMin = Math.min(globalMin, d.niftyMicrocap250NAV);
  });
  
  // If all hidden or no data, default to 0
  if (globalMin === Infinity) globalMin = 0;

  const yDomainMin = Math.floor(globalMin - 10);

  const handleDateRangeChange = (_event: React.MouseEvent<HTMLElement>, newRange: DateRange | null) => {
    if (newRange !== null) {
      setDateRange(newRange);
    }
  };

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center">
                <FontAwesomeIcon icon={faChartLine} className="text-blue-400 text-lg" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Equity Curve</span>
        </div>
      
        <div className="flex flex-col sm:flex-row gap-4 items-center w-full md:w-auto justify-end">
        {dateRange === 'CUSTOM' && (
            <div className="flex gap-2 items-center animate-fade-in-right">
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                    <DatePicker
                        label="Start Date"
                        value={customStart}
                        format="dd/MM/yyyy"
                        onChange={(newValue) => setCustomStart(newValue)}
                        slotProps={{ 
                            textField: { 
                                size: 'small', 
                                sx: { 
                                    width: 150,
                                    '& .MuiInputBase-root': {
                                        height: '32px',
                                        fontSize: '0.75rem',
                                        backgroundColor: 'rgba(15, 23, 42, 0.4)',
                                    },
                                    input: { color: 'white', padding: '4px 8px' },
                                    label: { 
                                        color: '#9ca3af', 
                                        fontSize: '0.75rem',
                                        transform: 'translate(14px, 8px) scale(1)',
                                        '&.Mui-focused, &.MuiFormLabel-filled': {
                                            transform: 'translate(14px, -9px) scale(0.75)',
                                        }
                                    },
                                    fieldset: { borderColor: 'rgba(255,255,255,0.1)' },
                                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                                    '& .MuiSvgIcon-root': { color: '#9ca3af', fontSize: '1rem' }
                                } 
                            } 
                        }}
                    />
                    <span className="text-gray-500 font-medium">-</span>
                    <DatePicker
                        label="End Date"
                        value={customEnd}
                        format="dd/MM/yyyy"
                        onChange={(newValue) => setCustomEnd(newValue)}
                        slotProps={{ 
                            textField: { 
                                size: 'small', 
                                sx: { 
                                    width: 150,
                                    '& .MuiInputBase-root': {
                                        height: '32px',
                                        fontSize: '0.75rem',
                                        backgroundColor: 'rgba(15, 23, 42, 0.4)',
                                    },
                                    input: { color: 'white', padding: '4px 8px' },
                                    label: { 
                                        color: '#9ca3af', 
                                        fontSize: '0.75rem',
                                        transform: 'translate(14px, 8px) scale(1)',
                                        '&.Mui-focused, &.MuiFormLabel-filled': {
                                            transform: 'translate(14px, -9px) scale(0.75)',
                                        }
                                    },
                                    fieldset: { borderColor: 'rgba(255,255,255,0.1)' },
                                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                                    '& .MuiSvgIcon-root': { color: '#9ca3af', fontSize: '1rem' }
                                } 
                            } 
                        }}
                    />
                </LocalizationProvider>
            </div>
        )}
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
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#3b82f6',
                borderColor: 'rgba(59, 130, 246, 0.4)',
                '&:hover': {
                  backgroundColor: 'rgba(59, 130, 246, 0.3)',
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
          <ToggleButton value="CUSTOM">CUSTOM</ToggleButton>
        </ToggleButtonGroup>
      </div>
    </div>
      <div className="h-[300px] md:h-[500px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 10 }}>
          <defs>
            <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="niftyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="momentumGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="midcapGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="smallcapGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ec4899" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="microcapGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#facc15" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
            </linearGradient>
          </defs>
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
            tickFormatter={(value) => value.toFixed(0)}
            domain={[yDomainMin, 'auto']}
            allowDataOverflow={true} 
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="portfolioNAV"
            stroke="transparent"
            fill="url(#portfolioGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.portfolioNAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'portfolioNAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="portfolioNAV"
            name="My NAV"
            stroke="#3b82f6"
            strokeWidth={hoveredSeries === 'portfolioNAV' ? 4 : 3}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'portfolioNAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.portfolioNAV}
          />
          <Area
            type="monotone"
            dataKey="niftyNAV"
            stroke="transparent"
            fill="url(#niftyGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.niftyNAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'niftyNAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="niftyNAV"
            name="Nifty"
            stroke="#8b5cf6"
            strokeWidth={hoveredSeries === 'niftyNAV' ? 3.5 : 2.5}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'niftyNAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 5, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.niftyNAV}
            connectNulls={true}
          />

          <Area
            type="monotone"
            dataKey="nifty500Momentum50NAV"
            stroke="transparent"
            fill="url(#momentumGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.nifty500Momentum50NAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'nifty500Momentum50NAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="nifty500Momentum50NAV"
            name="N500M50"
            stroke="#10b981"
            strokeWidth={hoveredSeries === 'nifty500Momentum50NAV' ? 3 : 2}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'nifty500Momentum50NAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.nifty500Momentum50NAV}
            connectNulls={true}
          />
          <Area
            type="monotone"
            dataKey="niftyMidcap100NAV"
            stroke="transparent"
            fill="url(#midcapGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.niftyMidcap100NAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'niftyMidcap100NAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="niftyMidcap100NAV"
            name="Midcap 100"
            stroke="#f97316"
            strokeWidth={hoveredSeries === 'niftyMidcap100NAV' ? 3 : 2}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'niftyMidcap100NAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 5, fill: '#f97316', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.niftyMidcap100NAV}
            connectNulls={true}
          />

          <Area
            type="monotone"
            dataKey="niftySmallcap250NAV"
            stroke="transparent"
            fill="url(#smallcapGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.niftySmallcap250NAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'niftySmallcap250NAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="niftySmallcap250NAV"
            name="Smallcap 250"
            stroke="#ec4899"
            strokeWidth={hoveredSeries === 'niftySmallcap250NAV' ? 3 : 2}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'niftySmallcap250NAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 5, fill: '#ec4899', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.niftySmallcap250NAV}
          />

          <Area
            type="monotone"
            dataKey="niftyMicrocap250NAV"
            stroke="transparent"
            fill="url(#microcapGradient)"
            legendType="none"
            tooltipType="none"
            hide={!visible.niftyMicrocap250NAV}
            fillOpacity={hoveredSeries && hoveredSeries !== 'niftyMicrocap250NAV' ? 0.05 : 1}
          />
          <Line
            type="monotone"
            dataKey="niftyMicrocap250NAV"
            name="Microcap 250"
            stroke="#facc15"
            strokeWidth={hoveredSeries === 'niftyMicrocap250NAV' ? 3 : 2}
            strokeOpacity={hoveredSeries && hoveredSeries !== 'niftyMicrocap250NAV' ? 0.1 : 1}
            dot={false}
            activeDot={{ r: 5, fill: '#facc15', strokeWidth: 2, stroke: '#fff' }}
            hide={!visible.niftyMicrocap250NAV}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      
      {/* Custom Legend */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
        {[
          { key: 'portfolioNAV', label: 'My NAV', color: '#3b82f6' },
          { key: 'niftyNAV', label: 'Nifty', color: '#8b5cf6' },
          { key: 'nifty500Momentum50NAV', label: 'N500M50', color: '#10b981' },
          { key: 'niftyMidcap100NAV', label: 'Midcap 100', color: '#f97316' },
          { key: 'niftySmallcap250NAV', label: 'Smallcap 250', color: '#ec4899' },
          { key: 'niftyMicrocap250NAV', label: 'Microcap 250', color: '#facc15' },
        ].map((item) => {
          const isHidden = !visible[item.key];
          const isHovered = hoveredSeries === item.key;
          const isDimmed = hoveredSeries && !isHovered;

          return (
            <button 
              key={item.key}
              onClick={() => setVisible(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
              onMouseEnter={() => setHoveredSeries(item.key)}
              onMouseLeave={() => setHoveredSeries(null)}
              className={`
                flex items-center gap-2 py-1 transition-all duration-200 cursor-pointer
                ${isHidden ? 'opacity-40 grayscale' : ''}
                ${isHovered 
                    ? 'scale-105 opacity-100' 
                    : isDimmed 
                        ? 'opacity-30 blur-[0.5px]' 
                        : 'opacity-70 hover:opacity-100'}
              `}
            >
              <span 
                className="w-6 h-1.5 rounded-full shadow-sm" 
                style={{ backgroundColor: item.color }} 
              />
              <span className={`text-[11px] font-medium tracking-wide ${isHidden ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const validNames = ['My NAV', 'Nifty', 'N500M50', 'Midcap 100', 'Smallcap 250', 'Microcap 250'];
    const filteredPayload = payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((entry: any) => validNames.includes(entry.name))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort((a: any, b: any) => validNames.indexOf(a.name) - validNames.indexOf(b.name));
    
    if (filteredPayload.length === 0) return null;

    return (
      <div className="glass-card p-2 border border-white/10 shadow-xl bg-black/80 backdrop-blur-md">
        <p className="text-[10px] text-gray-400 mb-1">{format(parseISO(label), 'MMM dd, yyyy')}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {filteredPayload.map((entry: any, index: number) => (
          <div key={index} className="flex justify-between items-center gap-4 text-xs">
            <span className="font-medium" style={{ color: entry.color }}>{entry.name}</span>
            <span className="font-mono text-gray-200">{entry.value?.toFixed(2)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};
