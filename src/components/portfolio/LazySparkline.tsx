'use client';

import { useState, useEffect, memo } from 'react';
import SVGSparkline from './SVGSparkline';

interface LazySparklineProps {
    symbol: string;
    // Optional pre-loaded data - if provided, skip fetch
    initialData?: { date: string; close: number }[];
}

/**
 * Lazy-loaded sparkline that fetches data on demand.
 * Uses lightweight SVG-based sparkline instead of recharts (~200KB savings).
 */
function LazySparklineInner({ symbol, initialData }: LazySparklineProps) {
    const [data, setData] = useState<{ date: string; close: number }[] | null>(initialData || null);
    const [loading, setLoading] = useState(!initialData);
    const [error, setError] = useState(false);

    useEffect(() => {
        // Skip fetch if we have initial data
        if (initialData && initialData.length > 0) {
            setData(initialData);
            setLoading(false);
            return;
        }

        let cancelled = false;

        const fetchData = async () => {
            try {
                const response = await fetch(`/api/portfolio/sparkline?symbol=${encodeURIComponent(symbol)}`);
                if (!response.ok) throw new Error('Failed to fetch');
                const result = await response.json();
                
                if (!cancelled && result.data) {
                    setData(result.data);
                }
            } catch {
                if (!cancelled) {
                    setError(true);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            cancelled = true;
        };
    }, [symbol, initialData]);

    if (loading) {
        return (
            <div className="w-full h-[50px] flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-gray-700 border-t-gray-400 animate-spin" />
            </div>
        );
    }

    if (error || !data || data.length < 2) {
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
}

// Memoize to prevent unnecessary re-renders
export default memo(LazySparklineInner);
