'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullseye, faClock, faPercent } from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';
import AnimatedBar from '../ui/AnimatedBar';

interface PortfolioStatsCardsProps {
    winPercent: number;
    lossPercent: number;
    avgHoldingPeriod: number;
    avgWinnerGain: number;
    avgLoserLoss: number;
}

export function WinLossCard({ winPercent, lossPercent }: { winPercent: number; lossPercent: number }) {
    return (
        <div className="glass-card p-6 animate-fade-in-up stagger-7 h-full flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-red-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faBullseye} className="text-emerald-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Win / Loss Ratio</span>
            </div>
            <div className="flex-1 flex flex-col justify-center">
                <div className="flex justify-between text-sm mb-2 font-semibold">
                    <span className="text-emerald-400">
                        <AnimatedNumber value={winPercent} suffix="%" decimals={2} />
                    </span>
                    <span className="text-red-400">
                        <AnimatedNumber value={lossPercent} suffix="%" decimals={2} />
                    </span>
                </div>
                <div className="h-4 bg-gray-700/50 rounded-full overflow-hidden flex">
                    <AnimatedBar 
                        targetWidth={winPercent}
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                        duration={1000}
                        delay={300}
                    />
                    <AnimatedBar 
                        targetWidth={lossPercent}
                        className="h-full bg-gradient-to-r from-red-400 to-red-500"
                        duration={1000}
                        delay={500}
                    />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-2 font-medium">
                    <span>Winners</span>
                    <span>Losers</span>
                </div>
            </div>
        </div>
    );
}

export function AvgHoldingCard({ avgHoldingPeriod }: { avgHoldingPeriod: number }) {
    return (
        <div className="glass-card p-6 animate-fade-in-up stagger-6 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faClock} className="text-amber-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Avg. Holding</span>
            </div>
            <div className="flex-1 flex flex-col justify-center">
                <div className="text-4xl font-bold text-amber-400 mb-1">
                    <AnimatedNumber value={avgHoldingPeriod} suffix=" days" decimals={0} />
                </div>
                <div className="text-sm text-gray-500 font-medium">per closed trade</div>
            </div>
        </div>
    );
}

export function AvgGainLossCard({ avgWinnerGain, avgLoserLoss }: { avgWinnerGain: number; avgLoserLoss: number }) {
    return (
        <div className="glass-card p-6 animate-fade-in-up stagger-10 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-rose-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faPercent} className="text-green-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Avg. Gain / Loss</span>
            </div>
            <div className="flex-1 flex flex-col justify-center space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-20 text-right">
                        <span className="text-green-400 font-bold text-lg">
                            +<AnimatedNumber value={avgWinnerGain} suffix="%" decimals={2} />
                        </span>
                    </div>
                    <div className="flex-1 h-3 bg-gray-700/50 rounded-full overflow-hidden">
                        <AnimatedBar 
                            targetWidth={Math.min(avgWinnerGain, 100)}
                            className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full"
                            duration={1200}
                            delay={400}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-20 text-right">
                        <span className="text-rose-400 font-bold text-lg">
                            <AnimatedNumber value={avgLoserLoss} suffix="%" decimals={2} />
                        </span>
                    </div>
                    <div className="flex-1 h-3 bg-gray-700/50 rounded-full overflow-hidden">
                        <AnimatedBar 
                            targetWidth={Math.min(Math.abs(avgLoserLoss), 100)}
                            className="h-full bg-gradient-to-r from-rose-500 to-rose-400 rounded-full"
                            duration={1200}
                            delay={600}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PortfolioStatsCards({
    winPercent,
    lossPercent,
    avgHoldingPeriod,
    avgWinnerGain,
    avgLoserLoss
}: PortfolioStatsCardsProps) {
    return (
        <>
            <div className="col-span-1 md:col-span-2 h-full">
                <WinLossCard winPercent={winPercent} lossPercent={lossPercent} />
            </div>
            <div className="col-span-1 h-full">
                <AvgHoldingCard avgHoldingPeriod={avgHoldingPeriod} />
            </div>
            <div className="col-span-1 md:col-span-2 h-full">
                <AvgGainLossCard avgWinnerGain={avgWinnerGain} avgLoserLoss={avgLoserLoss} />
            </div>
        </>
    );
}

