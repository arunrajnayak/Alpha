'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';

interface ReturnsCardProps {
    weekReturn: number;
    monthReturn: number;
    yearReturn: number;
    oneYearReturn: number;
}

export default function ReturnsCard({
    weekReturn,
    monthReturn,
    yearReturn,
    oneYearReturn
}: ReturnsCardProps) {
    const getReturnColor = (val: number) => val >= 0 ? 'text-emerald-400' : 'text-red-400';

    return (
        <div className="glass-card p-6 animate-fade-in-up stagger-9 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faChartLine} className="text-purple-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Period Returns</span>
            </div>
            
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 content-center">
                {/* Week */}
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1">
                    <div className={`text-xl font-bold ${getReturnColor(weekReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(weekReturn)} 
                            prefix={Math.abs(weekReturn) < 0.01 ? '' : (weekReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(weekReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs uppercase font-bold text-gray-400 tracking-wider">Week</div>
                </div>

                {/* Month */}
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1">
                    <div className={`text-xl font-bold ${getReturnColor(monthReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(monthReturn)} 
                            prefix={Math.abs(monthReturn) < 0.01 ? '' : (monthReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(monthReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs uppercase font-bold text-gray-400 tracking-wider">Month</div>
                </div>

                {/* YTD */}
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1">
                    <div className={`text-xl font-bold ${getReturnColor(yearReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(yearReturn)} 
                            prefix={Math.abs(yearReturn) < 0.01 ? '' : (yearReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(yearReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs uppercase font-bold text-gray-400 tracking-wider">YTD</div>
                </div>

                {/* 1 Year */}
                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300 hover:-translate-y-1">
                    <div className={`text-xl font-bold ${getReturnColor(oneYearReturn)}`}>
                        <AnimatedNumber 
                            value={Math.abs(oneYearReturn)} 
                            prefix={Math.abs(oneYearReturn) < 0.01 ? '' : (oneYearReturn >= 0 ? '+' : '-')} 
                            suffix="%" 
                            decimals={Math.abs(oneYearReturn) < 0.01 ? 0 : 2}
                        />
                    </div>
                    <div className="text-xs uppercase font-bold text-gray-400 tracking-wider">1 Year</div>
                </div>
            </div>
        </div>
    );
}
