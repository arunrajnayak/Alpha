'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';

interface DashboardStatsCardsProps {
    weekReturn: number;
    monthReturn: number;
    yearReturn: number;
}

export default function DashboardStatsCards({
    weekReturn,
    monthReturn,
    yearReturn
}: DashboardStatsCardsProps) {
    const getReturnColor = (val: number) => val >= 0 ? 'text-emerald-400' : 'text-red-400';

    return (
        /* Returns Card - Week/Month/Year */
        <div className="glass-card p-4 animate-fade-in-up stagger-1">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faChartLine} className="text-purple-400 text-sm" />
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Returns</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                    <div className={`text-lg font-bold ${getReturnColor(weekReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(weekReturn)} 
                            prefix={Math.abs(weekReturn) < 0.01 ? '' : (weekReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(weekReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs text-gray-500">Week</div>
                </div>
                <div className="text-center">
                    <div className={`text-lg font-bold ${getReturnColor(monthReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(monthReturn)} 
                            prefix={Math.abs(monthReturn) < 0.01 ? '' : (monthReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(monthReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs text-gray-500">Month</div>
                </div>
                <div className="text-center">
                    <div className={`text-lg font-bold ${getReturnColor(yearReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(yearReturn)} 
                            prefix={Math.abs(yearReturn) < 0.01 ? '' : (yearReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(yearReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs text-gray-500">YTD</div>
                </div>
            </div>
        </div>
    );
}

