'use client';

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, subMonths, subYears, startOfYear, parseISO } from 'date-fns';
import { useState, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faScaleBalanced,
  faArrowTrendUp,
  faArrowTrendDown,
} from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RunningAlphaDataPoint = {
  date: Date | string;
  portfolioNAV: number;
  niftyNAV: number | null;
  nifty500Momentum50NAV: number | null;
  [key: string]: unknown;
};

type DateRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

interface RunningAlphaChartProps {
  data: RunningAlphaDataPoint[];
}

// ─── Series Configuration ─────────────────────────────────────────────────────

const SERIES_CONFIG = [
  {
    key: 'alphaNifty' as const,
    label: 'Alpha vs Nifty 50',
    shortLabel: 'vs Nifty 50',
    color: '#8b5cf6', // violet-500
    gradientId: 'gradient-alpha-nifty',
    benchKey: 'niftyReturn' as const,
    benchLabel: 'Nifty 50',
  },
  {
    key: 'alphaN500M50' as const,
    label: 'Alpha vs N500M50',
    shortLabel: 'vs N500M50',
    color: '#06b6d4', // cyan-500
    gradientId: 'gradient-alpha-n500m50',
    benchKey: 'n500m50Return' as const,
    benchLabel: 'N500M50',
  },
] as const;

type SeriesKey = (typeof SERIES_CONFIG)[number]['key'];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
  visible,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  visible: Record<SeriesKey, boolean>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  const formattedDate = label
    ? (() => {
        try {
          return format(parseISO(label), 'd MMMM yyyy');
        } catch {
          return label;
        }
      })()
    : '';

  return (
    <div className="glass-card p-3 border border-white/10 shadow-2xl bg-black/85 backdrop-blur-md rounded-xl min-w-[220px]">
      <p className="text-[11px] font-medium text-gray-400 mb-2 pb-1.5 border-b border-white/10">
        {formattedDate}
      </p>

      {/* Portfolio return in selected timeframe */}
      <div className="flex justify-between items-center text-xs mb-2">
        <span className="text-gray-400 font-medium">Portfolio Return</span>
        <span
          className={`font-mono font-bold ${
            (dataPoint.pfReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {dataPoint.pfReturn != null
            ? `${dataPoint.pfReturn >= 0 ? '+' : ''}${dataPoint.pfReturn.toFixed(2)}%`
            : '—'}
        </span>
      </div>

      <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
        {SERIES_CONFIG.map((s) => {
          if (!visible[s.key]) return null;
          const alphaVal = dataPoint[s.key] as number | null;
          const benchReturn = dataPoint[s.benchKey] as number | null;
          if (alphaVal == null) return null;
          const isPos = alphaVal >= 0;

          return (
            <div key={s.key} className="flex flex-col gap-0.5">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-semibold text-gray-200">{s.label}</span>
                </div>
                <span
                  className={`font-mono font-bold ${
                    isPos ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isPos ? '+' : ''}
                  {alphaVal.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 pl-3.5">
                <span>
                  {s.benchLabel}:{' '}
                  {benchReturn != null
                    ? `${benchReturn >= 0 ? '+' : ''}${benchReturn.toFixed(2)}%`
                    : '—'}
                </span>
                <span className={`italic ${isPos ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                  {isPos ? 'Outperforming' : 'Lagging'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function RunningAlphaChart({ data }: RunningAlphaChartProps) {
  const [dateRange, setDateRange] = useState<DateRange>('ALL');
  const [hoveredSeries, setHoveredSeries] = useState<SeriesKey | null>(null);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    alphaNifty: true,
    alphaN500M50: true,
  });

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

    return data.filter((d) => {
      const date = typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date);
      return date >= startDate && date <= endDate;
    });
  }, [data, dateRange]);

  // Compute cumulative running alpha relative to base point of the filtered window
  const chartData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return [];

    const basePortfolio = filteredData[0]?.portfolioNAV;
    const baseNifty = filteredData.find((d) => d.niftyNAV != null)?.niftyNAV;
    const baseN500M50 = filteredData.find((d) => d.nifty500Momentum50NAV != null)?.nifty500Momentum50NAV;

    return filteredData.map((d) => {
      const dateObj = typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date);
      const dateStr = format(dateObj, 'yyyy-MM-dd');

      const pfReturn =
        basePortfolio && basePortfolio > 0 && d.portfolioNAV != null
          ? ((d.portfolioNAV / basePortfolio) - 1) * 100
          : null;

      const niftyReturn =
        baseNifty && baseNifty > 0 && d.niftyNAV != null
          ? ((d.niftyNAV / baseNifty) - 1) * 100
          : null;

      const n500m50Return =
        baseN500M50 && baseN500M50 > 0 && d.nifty500Momentum50NAV != null
          ? ((d.nifty500Momentum50NAV / baseN500M50) - 1) * 100
          : null;

      const alphaNifty =
        pfReturn != null && niftyReturn != null
          ? Number((pfReturn - niftyReturn).toFixed(2))
          : null;

      const alphaN500M50 =
        pfReturn != null && n500m50Return != null
          ? Number((pfReturn - n500m50Return).toFixed(2))
          : null;

      return {
        date: dateObj,
        dateStr,
        pfReturn,
        niftyReturn,
        n500m50Return,
        alphaNifty,
        alphaN500M50,
      };
    });
  }, [filteredData]);

  // Month-boundary ticks for X-axis
  const monthTicks = useMemo(() => {
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const d of chartData) {
      const ym = d.dateStr.slice(0, 7);
      if (!seen.has(ym)) {
        seen.add(ym);
        ticks.push(d.dateStr);
      }
    }
    return ticks;
  }, [chartData]);

  // Dynamic Y-axis domain including parity (0)
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-5, 5];

    const vals: number[] = [];
    chartData.forEach((d) => {
      if (visible.alphaNifty && d.alphaNifty != null) vals.push(d.alphaNifty);
      if (visible.alphaN500M50 && d.alphaN500M50 != null) vals.push(d.alphaN500M50);
    });

    if (vals.length === 0) return [-5, 5];

    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0);
    const span = Math.max(max - min, 2);
    const padding = Math.max(span * 0.12, 1);

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData, visible]);

  // Latest running alpha values for the stat badges
  const latestPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const latestAlphaNifty = latestPoint?.alphaNifty ?? null;
  const latestAlphaN500M50 = latestPoint?.alphaN500M50 ?? null;

  const handleDateRangeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newRange: DateRange | null
  ) => {
    if (newRange !== null) {
      setDateRange(newRange);
    }
  };

  const toggleSeries = (key: SeriesKey) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!data || data.length === 0) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in min-h-[200px] flex flex-col items-center justify-center">
        <FontAwesomeIcon icon={faScaleBalanced} className="text-4xl text-gray-600 mb-4 block" />
        <p className="text-gray-400">No data to display</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up w-full h-full flex flex-col">
      {/* Header Row: Title, Latest Stats, Range Selector */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-4 gap-4">
        {/* Left: Icon & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center flex-shrink-0">
            <FontAwesomeIcon icon={faScaleBalanced} className="text-indigo-400 text-lg" />
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Running Alpha
          </span>
        </div>

        {/* Center: Live Alpha Badges */}
        <div className="flex flex-wrap items-center gap-2.5">
          {latestAlphaNifty != null && (
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs backdrop-blur-sm transition-colors ${
                latestAlphaNifty >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#8b5cf6' }}
              />
              <span className="text-gray-400 font-medium">vs Nifty:</span>
              <span className="font-bold font-mono">
                <AnimatedNumber
                  value={Math.abs(latestAlphaNifty)}
                  prefix={latestAlphaNifty >= 0 ? '+' : '-'}
                  suffix="%"
                  decimals={2}
                />
              </span>
              <FontAwesomeIcon
                icon={latestAlphaNifty >= 0 ? faArrowTrendUp : faArrowTrendDown}
                className="text-[10px]"
              />
            </motion.div>
          )}

          {latestAlphaN500M50 != null && (
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs backdrop-blur-sm transition-colors ${
                latestAlphaN500M50 >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#06b6d4' }}
              />
              <span className="text-gray-400 font-medium">vs N500M50:</span>
              <span className="font-bold font-mono">
                <AnimatedNumber
                  value={Math.abs(latestAlphaN500M50)}
                  prefix={latestAlphaN500M50 >= 0 ? '+' : '-'}
                  suffix="%"
                  decimals={2}
                />
              </span>
              <FontAwesomeIcon
                icon={latestAlphaN500M50 >= 0 ? faArrowTrendUp : faArrowTrendDown}
                className="text-[10px]"
              />
            </motion.div>
          )}
        </div>

        {/* Right: Date Range Selector */}
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
              padding: '0 11px',
              textTransform: 'none',
              '&.Mui-selected': {
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                borderColor: 'rgba(99, 102, 241, 0.4)',
                '&:hover': {
                  backgroundColor: 'rgba(99, 102, 241, 0.3)',
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
          {(['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as DateRange[]).map((r) => (
            <ToggleButton key={r} value={r}>
              {r}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {/* Chart */}
      <div className="h-[300px] md:h-[380px] w-full mt-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="gradient-alpha-nifty" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="gradient-alpha-n500m50" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />

            <XAxis
              dataKey="dateStr"
              stroke="#6b7280"
              tickFormatter={(v) => {
                try {
                  return format(
                    parseISO(v),
                    dateRange === '1M' || dateRange === '3M' ? 'd MMM' : "MMM ''yy"
                  );
                } catch {
                  return v;
                }
              }}
              ticks={monthTicks.length > 1 ? monthTicks : undefined}
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
              tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
              domain={yDomain}
            />

            <Tooltip content={<CustomTooltip visible={visible} />} />

            {/* Parity (0% alpha) Reference Line */}
            <ReferenceLine
              y={0}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              strokeDasharray="4 4"
              label={{
                value: 'Parity (0%)',
                fill: '#9ca3af',
                fontSize: 10,
                position: 'right',
              }}
            />

            {/* Series 1: Alpha vs Nifty 50 */}
            {visible.alphaNifty && (
              <Area
                type="monotone"
                dataKey="alphaNifty"
                stroke="#8b5cf6"
                strokeWidth={hoveredSeries === 'alphaNifty' ? 3 : 2}
                strokeOpacity={hoveredSeries && hoveredSeries !== 'alphaNifty' ? 0.2 : 1}
                fill="url(#gradient-alpha-nifty)"
                isAnimationActive={true}
                animationDuration={1200}
                animationEasing="ease-out"
                dot={false}
                activeDot={{ r: 5, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
              />
            )}

            {/* Series 2: Alpha vs N500M50 */}
            {visible.alphaN500M50 && (
              <Area
                type="monotone"
                dataKey="alphaN500M50"
                stroke="#06b6d4"
                strokeWidth={hoveredSeries === 'alphaN500M50' ? 3 : 2}
                strokeOpacity={hoveredSeries && hoveredSeries !== 'alphaN500M50' ? 0.2 : 1}
                fill="url(#gradient-alpha-n500m50)"
                isAnimationActive={true}
                animationDuration={1200}
                animationEasing="ease-out"
                dot={false}
                activeDot={{ r: 5, fill: '#06b6d4', strokeWidth: 2, stroke: '#fff' }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Interactive Legend with toggle & hover effects */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
        {SERIES_CONFIG.map(({ key, label, color }) => {
          const isHidden = !visible[key];
          const isHovered = hoveredSeries === key;
          const isDimmed = hoveredSeries !== null && !isHovered;

          return (
            <motion.button
              key={key}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggleSeries(key)}
              onMouseEnter={() => setHoveredSeries(key)}
              onMouseLeave={() => setHoveredSeries(null)}
              className={`
                flex items-center gap-2 py-1 px-3 rounded-lg transition-all duration-200 cursor-pointer
                ${isHidden ? 'opacity-40 grayscale bg-white/5' : 'bg-white/5 hover:bg-white/10'}
                ${
                  isHovered
                    ? 'scale-105 opacity-100 ring-1 ring-white/20'
                    : isDimmed
                    ? 'opacity-30 blur-[0.5px]'
                    : 'opacity-85 hover:opacity-100'
                }
              `}
            >
              <span
                className="w-5 h-2 rounded-full shadow-sm"
                style={{ backgroundColor: color }}
              />
              <span
                className={`text-[11px] font-semibold tracking-wide ${
                  isHidden ? 'text-gray-500 line-through' : 'text-gray-200'
                }`}
              >
                {label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
