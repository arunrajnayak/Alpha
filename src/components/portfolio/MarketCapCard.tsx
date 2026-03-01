'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartPie } from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';
import AnimatedBar from '../ui/AnimatedBar';

interface MarketCapCardProps {
    largeCapPercent: number;
    midCapPercent: number;
    smallCapPercent: number;
    microCapPercent: number;
}

export default function MarketCapCard({
    largeCapPercent,
    midCapPercent,
    smallCapPercent,
    microCapPercent
}: MarketCapCardProps) {
    const formatPercent = (val: number) => `${val.toFixed(1)}%`;

    return (
        <div className="glass-card p-6 animate-fade-in-up stagger-8 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faChartPie} className="text-indigo-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Market Cap Allocation</span>
            </div>
            
            {/* Stacked Bar Chart */}
            {/* Content Wrapper for Vertical Centering */}
            <div className="flex-1 flex flex-col justify-center">
                {/* Stacked Bar Chart */}
                <div className="h-4 rounded-full overflow-hidden flex mb-4 bg-gray-800/50 w-full">
                    {largeCapPercent > 0 && (
                        <AnimatedBar 
                            targetWidth={largeCapPercent}
                            className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                            title={`Large: ${formatPercent(largeCapPercent)}`}
                            duration={1200}
                            delay={200}
                        />
                    )}
                    {midCapPercent > 0 && (
                        <AnimatedBar 
                            targetWidth={midCapPercent}
                            className="h-full bg-gradient-to-r from-violet-500 to-violet-400"
                            title={`Mid: ${formatPercent(midCapPercent)}`}
                            duration={1200}
                            delay={400}
                        />
                    )}
                    {smallCapPercent > 0 && (
                        <AnimatedBar 
                            targetWidth={smallCapPercent}
                            className="h-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-400"
                            title={`Small: ${formatPercent(smallCapPercent)}`}
                            duration={1200}
                            delay={600}
                        />
                    )}
                    {microCapPercent > 0 && (
                        <AnimatedBar 
                            targetWidth={microCapPercent}
                            className="h-full bg-gradient-to-r from-lime-500 to-lime-400"
                            title={`Micro: ${formatPercent(microCapPercent)}`}
                            duration={1200}
                            delay={800}
                        />
                    )}
                </div>

                {/* Legend - Responsive Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-2">
                    <div className="text-center">
                        <div className="flex items-center gap-1.5 justify-center mb-0.5">
                            <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
                            <span className="text-lg font-bold text-gray-200">
                                <AnimatedNumber value={largeCapPercent} suffix="%" decimals={1} duration={1400} />
                            </span>
                        </div>
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Large Cap</div>
                    </div>
                    <div className="text-center">
                        <div className="flex items-center gap-1.5 justify-center mb-0.5">
                            <div className="w-2 h-2 rounded-full bg-violet-400"></div>
                            <span className="text-lg font-bold text-gray-200">
                                <AnimatedNumber value={midCapPercent} suffix="%" decimals={1} duration={1400} />
                            </span>
                        </div>
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Mid Cap</div>
                    </div>
                    <div className="text-center">
                        <div className="flex items-center gap-1.5 justify-center mb-0.5">
                            <div className="w-2 h-2 rounded-full bg-fuchsia-400"></div>
                            <span className="text-lg font-bold text-gray-200">
                                <AnimatedNumber value={smallCapPercent} suffix="%" decimals={1} duration={1400} />
                            </span>
                        </div>
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Small Cap</div>
                    </div>
                    <div className="text-center">
                        <div className="flex items-center gap-1.5 justify-center mb-0.5">
                            <div className="w-2 h-2 rounded-full bg-lime-400"></div>
                            <span className="text-lg font-bold text-gray-200">
                                <AnimatedNumber value={microCapPercent} suffix="%" decimals={1} duration={1400} />
                            </span>
                        </div>
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Micro Cap</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
