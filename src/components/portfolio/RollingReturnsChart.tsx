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
import { format, parseISO } from 'date-fns';
import { useState, useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';

// ─── Types ───────────────────────────────────────────────────────────────────

type DataPoint = {
  date: Date | string;
  portfolioNAV: number;
  niftyNAV: number | null;
  nifty500Momentum50NAV: number | null;
  [key: string]: unknown;
};

type RollingWindow = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y';

interface RollingDataPoint {
  dateStr: string;
  portfolio: number | null;
  nifty: number | null;
  n500m50: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approximate trading-day count for each rolling window */
const WINDOW_TRADING_DAYS: Record<RollingWindow, number> = {
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
  '2Y': 504,
  '3Y': 756,
  '5Y': 1260,
};

/**
 * Minimum total data points required to display a window option.
 * We need at least windowDays + 1 points to produce even one rolling value.
 * Use 1× so that as soon as enough history exists the button appears.
 */
const MIN_POINTS_MULTIPLIER = 1;

const ALL_WINDOWS: RollingWindow[] = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y'];

const SERIES_CONFIG = [
  { key: 'portfolio' as const, label: 'Portfolio', color: '#3b82f6' },
  { key: 'nifty' as const,     label: 'Nifty',     color: '#8b5cf6' },
  { key: 'n500m50' as const,   label: 'Nifty 500',   color: '#10b981' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeRollingReturns(
  data: DataPoint[],
  windowDays: number
): RollingDataPoint[] {
  const result: RollingDataPoint[] = [];

  for (let i = windowDays; i < data.length; i++) {
    const curr = data[i];
    const prev = data[i - windowDays];

    const dateStr = format(new Date(curr.date), 'yyyy-MM-dd');

    const portfolio =
      curr.portfolioNAV && prev.portfolioNAV
        ? ((curr.portfolioNAV / prev.portfolioNAV) - 1) * 100
        : null;

    const nifty =
      curr.niftyNAV != null && prev.niftyNAV != null && prev.niftyNAV !== 0
        ? ((curr.niftyNAV / prev.niftyNAV) - 1) * 100
        : null;

    const n500m50 =
      curr.nifty500Momentum50NAV != null &&
      prev.nifty500Momentum50NAV != null &&
      prev.nifty500Momentum50NAV !== 0
        ? ((curr.nifty500Momentum50NAV / prev.nifty500Momentum50NAV) - 1) * 100
        : null;

    result.push({ dateStr, portfolio, nifty, n500m50 });
  }

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RollingReturnsChart({ data }: { data: DataPoint[] }) {
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    portfolio: true,
    nifty: true,
    n500m50: true,
  });

  // Determine which window options are available based on data length
  const availableWindows = useMemo<RollingWindow[]>(() => {
    if (!data || data.length === 0) return [];
    return ALL_WINDOWS.filter(
      (w) => data.length >= WINDOW_TRADING_DAYS[w] * MIN_POINTS_MULTIPLIER
    );
  }, [data]);

  const [selectedWindow, setSelectedWindow] = useState<RollingWindow | null>(null);

  // Default to shortest available window on first render / when data changes
  const activeWindow: RollingWindow | null = useMemo(() => {
    if (selectedWindow && availableWindows.includes(selectedWindow)) {
      return selectedWindow;
    }
    return availableWindows[0] ?? null;
  }, [selectedWindow, availableWindows]);

  // Compute rolling return series for the active window
  const rollingData = useMemo<RollingDataPoint[]>(() => {
    if (!activeWindow || !data || data.length === 0) return [];
    const windowDays = WINDOW_TRADING_DAYS[activeWindow];
    return computeRollingReturns(data, windowDays);
  }, [data, activeWindow]);

  // Month-boundary ticks for X-axis
  const monthTicks = useMemo(() => {
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const d of rollingData) {
      const ym = d.dateStr.slice(0, 7);
      if (!seen.has(ym)) { seen.add(ym); ticks.push(d.dateStr); }
    }
    return ticks;
  }, [rollingData]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleWindowChange = (
    _event: React.MouseEvent<HTMLElement>,
    newWindow: RollingWindow | null
  ) => {
    if (newWindow !== null) setSelectedWindow(newWindow);
  };

  const toggleSeries = (key: string) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Edge cases ──────────────────────────────────────────────────────────────

  if (!data || data.length === 0) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in min-h-[200px] flex flex-col items-center justify-center">
        <FontAwesomeIcon icon={faChartLine} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400">No data to display</p>
      </div>
    );
  }

  if (availableWindows.length === 0) {
    return (
      <div className="animate-fade-in-up w-full h-full flex flex-col min-h-[200px]">
        <CardHeader />
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Not enough data to compute rolling returns yet.
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      {/* Header row */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
        <CardHeader />

        {/* Period toggle */}
        <ToggleButtonGroup
          value={activeWindow}
          exclusive
          onChange={handleWindowChange}
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
                backgroundColor: 'rgba(20, 184, 166, 0.2)',
                color: '#14b8a6',
                borderColor: 'rgba(20, 184, 166, 0.4)',
                '&:hover': {
                  backgroundColor: 'rgba(20, 184, 166, 0.3)',
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
              },
            },
          }}
        >
          {availableWindows.map((w) => (
            <ToggleButton key={w} value={w}>{w}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {/* Chart */}
      <div className="h-[300px] md:h-[400px] w-full mt-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rollingData} margin={{ top: 10, right: 5, left: -10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="dateStr"
              stroke="#6b7280"
              tickFormatter={(v) => format(parseISO(v), "MMM ''yy")}
              ticks={monthTicks}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
              axisLine={{ stroke: '#374151' }}
              minTickGap={30}
            />
            <YAxis
              stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickLine={{ stroke: '#4b5563' }}
              axisLine={{ stroke: '#374151' }}
              tickFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
            />
            <Tooltip content={<CustomTooltip activeWindow={activeWindow} />} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

            {SERIES_CONFIG.map(({ key, label, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={
                  hoveredSeries === key ? 3 : 2
                }
                strokeOpacity={
                  hoveredSeries && hoveredSeries !== key ? 0.1 : 1
                }
                dot={false}
                activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: '#fff' }}
                hide={!visible[key]}
                connectNulls={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
        {SERIES_CONFIG.map(({ key, label, color }) => {
          const isHidden = !visible[key];
          const isHovered = hoveredSeries === key;
          const isDimmed = hoveredSeries !== null && !isHovered;

          return (
            <button
              key={key}
              onClick={() => toggleSeries(key)}
              onMouseEnter={() => setHoveredSeries(key)}
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
                style={{ backgroundColor: color }}
              />
              <span className={`text-[11px] font-medium tracking-wide ${isHidden ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-500/5 flex items-center justify-center">
        <FontAwesomeIcon icon={faChartLine} className="text-teal-400 text-lg" />
      </div>
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
        Rolling Returns
      </span>
    </div>
  );
}

 
const CustomTooltip = ({ active, payload, label, activeWindow }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const validNames = SERIES_CONFIG.map((s) => s.label);
  const filtered = payload
     
    .filter((e: any) => validNames.includes(e.name) && e.value != null)
     
    .sort((a: any, b: any) => validNames.indexOf(a.name) - validNames.indexOf(b.name));

  if (filtered.length === 0) return null;

  return (
    <div className="glass-card p-2 border border-white/10 shadow-xl bg-black/80 backdrop-blur-md">
      <p className="text-[10px] text-gray-400 mb-1">
        {format(parseISO(label), 'MMM dd, yyyy')}
        {activeWindow && (
          <span className="ml-1 text-teal-400 font-semibold">({activeWindow} rolling)</span>
        )}
      </p>
      { }
      {filtered.map((entry: any, i: number) => {
        const val: number = entry.value;
        const isPositive = val >= 0;
        return (
          <div key={i} className="flex justify-between items-center gap-4 text-xs">
            <span className="font-medium" style={{ color: entry.color }}>
              {entry.name}
            </span>
            <span className={`font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{val.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};
