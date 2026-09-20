'use client';

import { memo, useMemo } from 'react';

interface IntradaySparklineProps {
  data?: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  trendPositive?: boolean;
  className?: string;
  uniqueId?: string;
}

/**
 * Lightweight SVG sparkline for intraday stock price movement.
 * Renders smooth polyline and area gradient with trend-aware coloring.
 */
function IntradaySparklineInner({
  data,
  width = 86,
  height = 26,
  strokeWidth = 1.5,
  trendPositive = true,
  className = '',
  uniqueId = 'spark',
}: IntradaySparklineProps) {
  const { points, color, minY, maxY, hasData } = useMemo(() => {
    if (!data || data.length < 2) {
      return { points: '', color: '#6b7280', minY: 0, maxY: 0, hasData: false };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || (min * 0.01) || 1;

    const pad = strokeWidth;
    const chartW = width - pad * 2;
    const chartH = height - pad * 2;

    const pts = data.map((val, i) => {
      const x = pad + (i / (data.length - 1)) * chartW;
      const y = pad + chartH - ((val - min) / range) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const strokeColor = trendPositive ? '#10b981' : '#f43f5e'; // emerald-500 or rose-500

    return { points: pts, color: strokeColor, minY: min, maxY: max, hasData: true };
  }, [data, width, height, strokeWidth, trendPositive]);

  if (!hasData) {
    return (
      <div
        className={`flex items-center justify-center text-gray-600 text-[10px] font-mono ${className}`}
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  const gradId = `sparkline-grad-${uniqueId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible ${className}`}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {/* Area Fill */}
      <polygon
        points={`${strokeWidth},${height - strokeWidth} ${points} ${width - strokeWidth},${height - strokeWidth}`}
        fill={`url(#${gradId})`}
      />

      {/* Stroke Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default memo(IntradaySparklineInner);
