'use client';

import { memo } from 'react';
import SVGSparkline from './SVGSparkline';

interface StockSparklineProps {
    data: { date: string; close: number }[];
}

/**
 * Memoized sparkline chart component.
 * Uses lightweight SVG implementation (~200KB smaller than recharts).
 * Re-renders only when data array reference changes.
 */
export default memo(function StockSparkline({ data }: StockSparklineProps) {
    if (!data || data.length < 2) {
        return (
            <div className="w-[80px] h-[40px] flex items-center justify-center text-gray-600 text-xs">
                —
            </div>
        );
    }
    
    return (
        <div className="w-full h-[50px] flex items-center justify-center px-1">
            <SVGSparkline 
                data={data} 
                width={100} 
                height={40} 
                strokeWidth={1.5}
            />
        </div>
    );
});
