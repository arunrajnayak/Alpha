'use client';

import { memo, useMemo } from 'react';

interface SVGSparklineProps {
    data: { date: string; close: number }[];
    width?: number;
    height?: number;
    strokeWidth?: number;
    className?: string;
}

/**
 * Lightweight SVG-based sparkline component.
 * Replaces recharts for ~200KB bundle savings.
 * 
 * Uses native SVG polyline for minimal overhead.
 */
function SVGSparklineInner({ 
    data, 
    width = 100, 
    height = 40, 
    strokeWidth = 1.5,
    className = ''
}: SVGSparklineProps) {
    const { points, color, minY, maxY } = useMemo(() => {
        if (!data || data.length < 2) {
            return { points: '', color: '#6b7280', minY: 0, maxY: 0 };
        }

        const values = data.map(d => d.close);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1; // Avoid division by zero

        // Padding for stroke
        const padding = strokeWidth;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        // Generate SVG polyline points
        const pts = data.map((d, i) => {
            const x = padding + (i / (data.length - 1)) * chartWidth;
            const y = padding + chartHeight - ((d.close - min) / range) * chartHeight;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        // Determine trend color
        const firstPrice = data[0].close;
        const lastPrice = data[data.length - 1].close;
        const lineColor = lastPrice >= firstPrice ? '#34d399' : '#f87171'; // emerald-400 or red-400

        return { points: pts, color: lineColor, minY: min, maxY: max };
    }, [data, width, height, strokeWidth]);

    if (!data || data.length < 2) {
        return (
            <div 
                className={`flex items-center justify-center text-gray-600 text-xs ${className}`}
                style={{ width, height }}
            >
                —
            </div>
        );
    }

    return (
        <svg 
            width={width} 
            height={height} 
            viewBox={`0 0 ${width} ${height}`}
            className={className}
            style={{ overflow: 'visible' }}
        >
            {/* Gradient fill under the line */}
            <defs>
                <linearGradient id={`sparkline-gradient-${minY}-${maxY}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            
            {/* Area fill */}
            <polygon
                points={`${strokeWidth},${height - strokeWidth} ${points} ${width - strokeWidth},${height - strokeWidth}`}
                fill={`url(#sparkline-gradient-${minY}-${maxY})`}
            />
            
            {/* Line */}
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

export default memo(SVGSparklineInner);
