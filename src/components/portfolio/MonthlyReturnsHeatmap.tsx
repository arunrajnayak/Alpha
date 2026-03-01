'use client';

import React, { useMemo } from 'react';
import { getYear, getMonth } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';
import { MonthlyPortfolioSnapshot } from '@prisma/client';

type SnapshotDataPoint = {
  date: Date | string;
  dailyPnL?: number | null;
  dailyReturn?: number | null;
};

interface MonthlyReturnsHeatmapProps {
  data: SnapshotDataPoint[];
  monthlySnapshots?: MonthlyPortfolioSnapshot[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Helper to format percentage
function formatPercentage(val: number): string {
  const percentage = val * 100;
  const sign = percentage >= 0 ? '+' : '';
  return `${sign}${percentage.toFixed(1)}%`;
}



export default function MonthlyReturnsHeatmap({ data, monthlySnapshots }: MonthlyReturnsHeatmapProps) {
  
  const heatmapData = useMemo(() => {
    // 1. Create a map from monthlySnapshots (Source of Truth)
    const snapshotMap = new Map<string, number>();
    if (monthlySnapshots) {
        monthlySnapshots.forEach(s => {
            const date = new Date(s.date);
            const key = `${getYear(date)}-${getMonth(date)}`;
            snapshotMap.set(key, s.monthlyReturn || 0);
        });
    }

    // 2. Identify years and months that need daily compounding (fallback/current month)
    const yearsMap = new Map<number, Map<number, number[]>>(); // Year -> Month -> Daily Returns[]

    if (data) {
        data.forEach(d => {
            const date = new Date(d.date);
            const year = getYear(date);
            const month = getMonth(date);
            const ret = d.dailyReturn ?? 0;

            if (!yearsMap.has(year)) {
                yearsMap.set(year, new Map<number, number[]>());
            }
            const monthMap = yearsMap.get(year)!;
            if (!monthMap.has(month)) {
                monthMap.set(month, []);
            }
            monthMap.get(month)!.push(ret);
        });
    }

    if (yearsMap.size === 0 && snapshotMap.size === 0) return null;

    // 3. Calculate monthly and yearly returns
    const result = {
        years: [] as number[],
        monthlyReturns: new Map<string, number>(), // "year-month" -> return
        yearlyReturns: new Map<number, number>(), // year -> return
        maxGain: 0.05, // Default min threshold of 5%
        maxLoss: -0.05 // Default min threshold of -5%
    };

    // Combine all years from both sources
    const allYears = new Set([...Array.from(yearsMap.keys())]);
    if (monthlySnapshots) {
        monthlySnapshots.forEach(s => allYears.add(getYear(new Date(s.date))));
    }

    const sortedYears = Array.from(allYears).sort((a, b) => b - a);
    result.years = sortedYears;

    let maxGain = 0;
    let maxLoss = 0;

    sortedYears.forEach(year => {
        let yearlyCompounded = 1.0;
        let hasYearlyData = false;

        // Iterate all months 0-11
        for (let m = 0; m < 12; m++) {
            const key = `${year}-${m}`;
            let finalRet = 0;
            let hasMonthVal = false;
            
            // Check Source of Truth first
            if (snapshotMap.has(key)) {
                finalRet = snapshotMap.get(key)!;
                hasMonthVal = true;
                yearlyCompounded *= (1 + finalRet);
                hasYearlyData = true;
            } else {
                // Fallback to daily compounding
                const monthMap = yearsMap.get(year);
                const dailyReturns = monthMap?.get(m);
                if (dailyReturns && dailyReturns.length > 0) {
                    const monthlyCompounded = dailyReturns.reduce((acc, r) => acc * (1 + r), 1.0);
                    finalRet = monthlyCompounded - 1;
                    hasMonthVal = true;
                    yearlyCompounded *= monthlyCompounded;
                    hasYearlyData = true;
                }
            }

            if (hasMonthVal) {
                result.monthlyReturns.set(key, finalRet);
                if (finalRet > maxGain) maxGain = finalRet;
                if (finalRet < maxLoss) maxLoss = finalRet;
            }
        }
        
        if (hasYearlyData) {
            result.yearlyReturns.set(year, yearlyCompounded - 1);
        }
    });

    // Ensure we have at least some range to avoid division by zero
    // and to keep colors reasonable for small variance portfolios
    result.maxGain = Math.max(maxGain, 0.05);
    result.maxLoss = Math.min(maxLoss, -0.05);

    return result;

  }, [data, monthlySnapshots]);

    // Interpolate color based on value relative to min/max
    const getDynamicColor = (value: number) => {
        const { maxGain, maxLoss } = heatmapData || { maxGain: 0.05, maxLoss: -0.05 };
        
        if (value >= 0) {
            // Gains: Interpolate between Emerald 200 and Emerald 700
            // Emerald 200: 167, 243, 208
            // Emerald 700: 4, 120, 87
            const intensity = Math.min(value / maxGain, 1.0);
            
            const r = Math.round(167 + (4 - 167) * intensity);
            const g = Math.round(243 + (120 - 243) * intensity);
            const b = Math.round(208 + (87 - 208) * intensity);
            
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Losses: Interpolate between Red 200 and Red 700
            // Red 200: 254, 202, 202
            // Red 700: 185, 28, 28
            const intensity = Math.min(Math.abs(value) / Math.abs(maxLoss), 1.0);
            
            const r = Math.round(254 + (185 - 254) * intensity);
            const g = Math.round(202 + (28 - 202) * intensity);
            const b = Math.round(202 + (28 - 202) * intensity);
            
            return `rgb(${r}, ${g}, ${b})`;
        }
    };

    // Text color contrast helper
    const getTextColor = (value: number) => {
        const { maxGain, maxLoss } = heatmapData || { maxGain: 0.05, maxLoss: -0.05 };
        const absVal = Math.abs(value);
        const max = value >= 0 ? maxGain : Math.abs(maxLoss);
        
        // If intensity is high (> 60%), use light text, otherwise dark
        return (absVal / max) > 0.6 ? 'text-white' : 'text-slate-900';
    };

    if (!data || data.length === 0 || !heatmapData) {
        return (
            <div className="glass-card p-8 text-center animate-fade-in min-h-[200px] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                <FontAwesomeIcon icon={faCalendarDays} className="text-2xl text-gray-600" />
            </div>
            <p className="text-gray-300 font-medium">No performance data available</p>
            </div>
        );
    }

  return (
    <div className="animate-fade-in-up overflow-x-auto w-full">
        <table className="w-full border-collapse min-w-[600px]">
            <thead>
                <tr>
                    <th className="text-left py-2 md:py-3 px-1 md:px-2 text-[10px] md:text-xs font-semibold text-gray-400 w-12 md:w-16">Year</th>
                    {MONTHS.map(m => (
                        <th key={m} className="text-center py-2 md:py-3 px-1 text-[10px] md:text-xs font-semibold text-gray-400">{m}</th>
                    ))}
                    <th className="text-center py-2 md:py-3 px-1 md:px-2 text-[10px] md:text-xs font-bold text-white w-16 md:w-20">Total</th>
                </tr>
            </thead>
            <tbody>
                {heatmapData.years.map(year => (
                    <tr key={year} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                        <td className="text-left py-4 px-2 text-sm font-bold text-gray-300">{year}</td>
                        {MONTHS.map((_, index) => {
                            const key = `${year}-${index}`;
                            const hasValue = heatmapData.monthlyReturns.has(key);
                            const val = heatmapData.monthlyReturns.get(key) ?? 0;
                            
                            return (
                                <td key={key} className="p-1">
                                    {hasValue ? (
                                        <div 
                                            className={`w-full h-10 rounded flex items-center justify-center text-xs font-bold cursor-default transition-transform hover:scale-105 ${getTextColor(val)}`}
                                            style={{ 
                                                backgroundColor: getDynamicColor(val),
                                            }}
                                            title={`${MONTHS[index]} ${year}: ${formatPercentage(val)}`}
                                        >
                                            <span style={{ textShadow: getTextColor(val) === 'text-white' ? '0 1px 2px rgba(0,0,0,0.3)' : 'none' }}>
                                                {formatPercentage(val)}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="w-full h-10 rounded bg-white/5 flex items-center justify-center">
                                            <span className="text-gray-600 text-[10px]">-</span>
                                        </div>
                                    )}
                                </td>
                            );
                        })}
                        <td className="p-1">
                             {heatmapData.yearlyReturns.has(year) && (
                                <div 
                                    className={`w-full h-10 rounded flex items-center justify-center text-xs font-bold ${
                                        (heatmapData.yearlyReturns.get(year) ?? 0) >= 0 ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'
                                    }`}
                                >
                                    {formatPercentage(heatmapData.yearlyReturns.get(year) ?? 0)}
                                </div>
                             )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );
}
