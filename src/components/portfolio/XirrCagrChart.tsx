'use client';

import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import { format, subMonths, subYears, startOfYear, parseISO } from 'date-fns';
import { useState, useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';

type DataPoint = {
  date: Date | string;
  xirr: number | null | undefined;
  cagr: number | null | undefined;
};

type DateRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

const XIRR_COLOR = '#10b981';  // emerald-500
const CAGR_COLOR = '#8b5cf6';  // violet-500

// Custom tooltip
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl">
      <p className="text-gray-400 text-xs mb-2 font-medium">
        {label ? format(parseISO(label), 'd MMM yyyy') : ''}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-300">{entry.name}:</span>
          <span className="font-semibold" style={{ color: entry.color }}>
            {entry.value != null ? `${(entry.value * 100).toFixed(2)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function XirrCagrChart({ data }: { data: DataPoint[] }) {
  const [dateRange, setDateRange] = useState<DateRange>('ALL');
  const [visibleXirr, setVisibleXirr] = useState(true);
  const [visibleCagr, setVisibleCagr] = useState(true);

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Filter out data points where both XIRR and CAGR are null/undefined to avoid Recharts domain auto-calc collapse
    const validData = data.filter(d => d.xirr != null || d.cagr != null);
    if (validData.length === 0) return [];

    const now = new Date();
    let startDate: Date;

    switch (dateRange) {
      case '1M': startDate = subMonths(now, 1); break;
      case '3M': startDate = subMonths(now, 3); break;
      case '6M': startDate = subMonths(now, 6); break;
      case 'YTD': startDate = startOfYear(now); break;
      case '1Y': startDate = subYears(now, 1); break;
      case 'ALL':
      default:
        return validData;
    }

    return validData.filter(d => {
      const date = typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date);
      return date >= startDate;
    });
  }, [data, dateRange]);

  const chartData = useMemo(() =>
    filteredData.map(d => ({
      ...d,
      dateStr: format(new Date(d.date), 'yyyy-MM-dd'),
    })),
    [filteredData]
  );

  // One tick per unique year-month
  const monthTicks = useMemo(() => {
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const d of chartData) {
      const ym = d.dateStr.slice(0, 7);
      if (!seen.has(ym)) { seen.add(ym); ticks.push(d.dateStr); }
    }
    return ticks;
  }, [chartData]);

  const handleDateRangeChange = (_: React.MouseEvent<HTMLElement>, val: DateRange | null) => {
    if (val !== null) setDateRange(val);
  };

  // Check if we have any data at all
  const hasXirr = data.some(d => d.xirr != null);
  const hasCagr = data.some(d => d.cagr != null);

  const toggleBtnSx = {
    height: '32px',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    '& .MuiToggleButton-root': {
      color: '#9ca3af',
      border: '1px solid rgba(255,255,255,0.1)',
      fontSize: '0.7rem',
      fontWeight: 600,
      padding: '0 10px',
      textTransform: 'none',
      '&.Mui-selected': {
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        color: '#10b981',
        borderColor: 'rgba(16, 185, 129, 0.4)',
        '&:hover': { backgroundColor: 'rgba(16, 185, 129, 0.3)' },
      },
      '&:hover': { backgroundColor: 'rgba(255,255,255,0.05)' },
    },
  };

  if (!data || data.length === 0 || (!hasXirr && !hasCagr)) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in">
        <FontAwesomeIcon icon={faChartLine} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400 text-sm">No XIRR / CAGR data yet.</p>
        <p className="text-gray-500 text-xs mt-1">Run a full recalculation from Settings to backfill.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center">
            <FontAwesomeIcon icon={faChartLine} className="text-emerald-400 text-lg" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">XIRR &amp; CAGR</span>
        </div>

        {/* Date Range Toggle */}
        <ToggleButtonGroup
          value={dateRange}
          exclusive
          onChange={handleDateRangeChange}
          size="small"
          sx={toggleBtnSx}
        >
          {(['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as DateRange[]).map(r => (
            <ToggleButton key={r} value={r}>{r}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {/* Chart */}
      <div className="h-[300px] md:h-[450px] w-full mt-4">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            No XIRR / CAGR data recorded for the selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 5, left: -10, bottom: 10 }}>
            <defs>
              <linearGradient id="xirrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={XIRR_COLOR} stopOpacity={0.15} />
                <stop offset="100%" stopColor={XIRR_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="cagrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CAGR_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={CAGR_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />

            <XAxis
              dataKey="dateStr"
              stroke="#6b7280"
              ticks={monthTicks}
              tickFormatter={v => format(parseISO(v), "MMM ''yy")}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
              axisLine={{ stroke: '#374151' }}
            />

            <YAxis
              stroke="#6b7280"
              tickFormatter={v => `${(v * 100).toFixed(0)}%`}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
              axisLine={{ stroke: '#374151' }}
              width={48}
            />

            <Tooltip content={<CustomTooltip />} />

            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />

            {visibleXirr && (
              <Line
                type="monotone"
                dataKey="xirr"
                name="XIRR"
                stroke={XIRR_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, fill: XIRR_COLOR, strokeWidth: 0 }}
              />
            )}

            {hasCagr && visibleCagr && (
              <Line
                type="monotone"
                dataKey="cagr"
                name="CAGR"
                stroke={CAGR_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, fill: CAGR_COLOR, strokeWidth: 0 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>

      {/* Custom Legend at Bottom (matching Equity Curve style) */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
        {[
          { key: 'xirr', label: 'XIRR', color: XIRR_COLOR, visible: visibleXirr, setVisible: setVisibleXirr },
          ...(hasCagr ? [{ key: 'cagr', label: 'CAGR', color: CAGR_COLOR, visible: visibleCagr, setVisible: setVisibleCagr }] : [])
        ].map((item) => {
          const isHidden = !item.visible;

          return (
            <button 
              key={item.key}
              onClick={() => item.setVisible(v => !v)}
              className={`
                flex items-center gap-2 py-1 transition-all duration-200 cursor-pointer
                ${isHidden ? 'opacity-40 grayscale' : 'opacity-70 hover:opacity-100'}
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
