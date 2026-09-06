'use client';

import React from 'react';
import { ToggleButtonGroup, ToggleButton } from '@mui/material';
import { ChartInterval, ChartPeriod, CandleBarStats, formatVolume } from '@/lib/chart-types';

interface Props {
  interval: ChartInterval;
  period?: ChartPeriod | null;
  onIntervalChange: (i: ChartInterval) => void;
  onPeriodChange: (p: ChartPeriod | null) => void;
  loading?: boolean;
  isLogScale?: boolean;
  onToggleLogScale?: () => void;
  candleStats?: CandleBarStats | null;
}

export default function ChartControls({
  interval,
  period = null,
  onIntervalChange,
  onPeriodChange,
  loading,
  isLogScale = false,
  onToggleLogScale,
  candleStats,
}: Props) {
  const handleIntervalChange = (
    event: React.MouseEvent<HTMLElement>,
    newInterval: ChartInterval | null,
  ) => {
    if (newInterval !== null && newInterval !== interval) {
      onIntervalChange(newInterval);
    }
  };

  const handlePeriodChange = (
    event: React.MouseEvent<HTMLElement>,
    newPeriod: ChartPeriod | null,
  ) => {
    onPeriodChange(newPeriod);
  };

  const toggleGroupStyle = {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '9999px',
    height: '32px',
    '& .MuiToggleButtonGroup-grouped': {
      border: 0,
      margin: '2px',
      borderRadius: '9999px !important',
      color: '#94a3b8',
      padding: '2px 10px',
      fontSize: '0.75rem',
      fontWeight: 600,
      textTransform: 'none',
      '&.Mui-selected': {
        color: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        '&:hover': {
          backgroundColor: 'rgba(56, 189, 248, 0.25)',
        },
      },
      '&:hover': {
        backgroundColor: 'rgba(255,255,255,0.06)',
      },
    },
  };

  const isIntraday = interval === '5minute';

  const change = candleStats ? candleStats.close - candleStats.open : 0;
  const changePct = candleStats && candleStats.open > 0 ? (change / candleStats.open) * 100 : 0;
  const isBullish = candleStats ? candleStats.close >= candleStats.open : true;
  const candleColor = isBullish ? '#10b981' : '#f23645';

  const renderCandleStats = () => {
    if (!candleStats) return null;
    return (
      <div className="flex items-center gap-2.5 sm:gap-3 text-xs font-mono select-none flex-wrap">
        <span className="text-slate-400">
          O <span style={{ color: candleColor }}>{candleStats.open.toFixed(2)}</span>
        </span>
        <span className="text-slate-400 font-bold">
          H <span style={{ color: candleColor }} className="font-bold">{candleStats.high.toFixed(2)}</span>
        </span>
        <span className="text-slate-400 font-bold">
          L <span style={{ color: candleColor }} className="font-bold">{candleStats.low.toFixed(2)}</span>
        </span>
        <span className="text-slate-400">
          C <span style={{ color: candleColor }}>{candleStats.close.toFixed(2)}</span>
        </span>
        <span style={{ color: candleColor }} className="font-semibold">
          ({change >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
        </span>
        {typeof candleStats.volume === 'number' && candleStats.volume > 0 && (
          <span className="text-slate-400">
            Vol <span style={{ color: candleColor }}>{formatVolume(candleStats.volume)}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5 py-1 w-full shrink-0">
      <div className="flex items-center justify-between gap-2.5 flex-wrap sm:flex-nowrap">
        {/* Left: Timeframe / Interval Toggles */}
        <div className="flex items-center gap-2 shrink-0">
          <ToggleButtonGroup
            value={interval}
            exclusive
            onChange={handleIntervalChange}
            aria-label="chart interval"
            sx={toggleGroupStyle}
          >
            <ToggleButton value="5minute" aria-label="5 minutes">5m</ToggleButton>
            <ToggleButton value="day" aria-label="day">D</ToggleButton>
            <ToggleButton value="week" aria-label="week">W</ToggleButton>
            <ToggleButton value="month" aria-label="month">M</ToggleButton>
          </ToggleButtonGroup>

          {loading && (
            <div className="flex items-center justify-center pl-1" title="Fetching candles...">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
            </div>
          )}
        </div>

        {/* Center: OHLC, Change, Volume (in place of DMA labels) */}
        {candleStats && (
          <div className="hidden lg:flex items-center justify-center px-2">
            {renderCandleStats()}
          </div>
        )}

        {/* Right: Period Toggles & Log Scale */}
        <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto max-w-full">
          <ToggleButtonGroup
            value={period}
            exclusive
            onChange={handlePeriodChange}
            aria-label="chart period"
            sx={toggleGroupStyle}
          >
            {(isIntraday
              ? [
                  { value: '1D' as const, label: '1D' },
                  { value: '2D' as const, label: '2D' },
                  { value: '5D' as const, label: '5D' },
                  { value: '1M' as const, label: '1M' },
                ]
              : [
                  { value: '1M' as const, label: '1M' },
                  { value: '3M' as const, label: '3M' },
                  { value: '6M' as const, label: '6M' },
                  { value: '1Y' as const, label: '1Y' },
                  { value: '2Y' as const, label: '2Y' },
                  { value: '5Y' as const, label: '5Y' },
                  { value: 'MAX' as const, label: 'MAX' },
                ]
            ).map(p => (
              <ToggleButton key={p.value} value={p.value} aria-label={p.label}>
                {p.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {onToggleLogScale && (
            <button
              type="button"
              onClick={onToggleLogScale}
              className={`h-8 px-2.5 rounded-full text-[11px] font-mono font-semibold border transition-all cursor-pointer select-none shrink-0 ${
                isLogScale
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-sm shadow-sky-500/25'
                  : 'bg-slate-900/60 text-slate-400 border-white/10 hover:text-white hover:bg-white/5'
              }`}
              title={isLogScale ? 'Logarithmic scale active (Click to switch to Linear)' : 'Linear scale active (Click to switch to Logarithmic)'}
            >
              LOG
            </button>
          )}
        </div>
      </div>

      {/* Center: OHLC, Change, Volume on smaller screens */}
      {candleStats && (
        <div className="flex lg:hidden items-center justify-start overflow-x-auto max-w-full px-1 py-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {renderCandleStats()}
        </div>
      )}
    </div>
  );
}
