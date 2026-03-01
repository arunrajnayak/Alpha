'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import { formatNumber } from '@/lib/format';
import { LiveDashboardData } from '@/app/actions/live';
import type { Variants } from 'framer-motion';

interface LiveStatsCardsProps {
    data: LiveDashboardData;
    prevData: LiveDashboardData | null;
    hasAnimatedInitial: boolean;
    setHasAnimatedInitial: (val: boolean) => void;
    downloading: boolean;
    privacyMode: boolean;
    isMobile: boolean;
    itemVariants: Variants;
    containerVariants: Variants;
}

const LiveStatsCards = memo(function LiveStatsCards({
    data,
    prevData,
    hasAnimatedInitial,
    setHasAnimatedInitial,
    downloading,
    privacyMode,
    isMobile,
    itemVariants,
    containerVariants
}: LiveStatsCardsProps) {
    const isPositive = data.dayGain >= 0;

    return (
        <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" variants={containerVariants}>
            {/* Total Equity Card */}
            <motion.div variants={itemVariants} className="relative overflow-hidden rounded-2xl border border-violet-500/20 shadow-xl h-[160px] bg-gradient-to-br from-slate-900 via-violet-950/40 to-slate-900">
                <div className="absolute inset-0 opacity-30" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(139, 92, 246, 0.15) 50%, transparent 100%)', animation: 'shimmer 3s ease-in-out infinite' }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-violet-500/20 rounded-full blur-3xl" />
                <div className="relative z-10 p-5 h-full flex flex-col justify-between">
                    <p className="text-xs font-medium text-violet-300/60 uppercase tracking-wider">Total Equity</p>
                    <h2 className="text-4xl font-bold bg-gradient-to-r from-violet-300 via-purple-200 to-white bg-clip-text text-transparent">
                        {privacyMode && !isMobile ? '****' : (
                            <>₹<CountUp 
                                start={hasAnimatedInitial ? (prevData?.totalEquity ?? data.totalEquity) : 0}
                                end={data.totalEquity} 
                                duration={downloading ? 0 : (!hasAnimatedInitial || (prevData && prevData.totalEquity !== data.totalEquity) ? 1.5 : 0)} 
                                formattingFn={(Val) => formatNumber(Val, 0, 0)} 
                                preserveValue 
                                onEnd={() => !hasAnimatedInitial && setHasAnimatedInitial(true)}
                            /></>
                        )}
                    </h2>
                </div>
                <style jsx>{` @keyframes shimmer { 0%, 100% { transform: translateX(-100%); } 50% { transform: translateX(100%); } } `}</style>
            </motion.div>

            {/* Day P&L Card */}
            <motion.div variants={itemVariants} className={`relative overflow-hidden rounded-2xl border shadow-xl h-[160px] ${isPositive ? 'border-emerald-500/30 bg-gradient-to-br from-slate-900 via-emerald-900/40 to-slate-900' : 'border-red-500/30 bg-gradient-to-br from-slate-900 via-red-900/40 to-slate-900'}`}>
                <div className="absolute inset-0 opacity-40" style={{ background: isPositive ? 'linear-gradient(90deg, transparent 0%, rgba(16, 185, 129, 0.2) 50%, transparent 100%)' : 'linear-gradient(90deg, transparent 0%, rgba(239, 68, 68, 0.2) 50%, transparent 100%)', animation: 'shimmer 3s ease-in-out infinite' }} />
                <div className="relative z-10 p-5 h-full flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                        <p className={`text-xs font-medium uppercase tracking-wider ${isPositive ? 'text-emerald-300/60' : 'text-red-300/60'}`}>Today&apos;s P&L</p>
                        <span className={`px-2.5 py-1 rounded-full text-lg font-bold ${isPositive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                            {isPositive ? '↑' : '↓'} {Math.abs(data.dayGainPercent).toFixed(2)}%
                        </span>
                    </div>
                    <h2 className={`text-4xl font-bold whitespace-nowrap ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {privacyMode && !isMobile ? '****' : (
                            <>{isPositive ? '+' : '-'}₹<CountUp 
                                start={hasAnimatedInitial ? Math.abs(prevData?.dayGain ?? data.dayGain) : 0}
                                end={Math.abs(data.dayGain)} 
                                duration={downloading ? 0 : (!hasAnimatedInitial || (prevData && prevData.dayGain !== data.dayGain) ? 1.5 : 0)} 
                                formattingFn={(Val) => formatNumber(Val, 0, 0)} 
                                preserveValue 
                                onEnd={() => !hasAnimatedInitial && setHasAnimatedInitial(true)}
                            /></>
                        )}
                    </h2>
                </div>
            </motion.div>

            {/* Market Breadth Card */}
            <motion.div variants={itemVariants} className="relative rounded-2xl border border-white/10 shadow-xl overflow-hidden h-[160px] bg-gradient-to-b from-red-950/80 to-red-900/60">
                <div className="absolute inset-0 opacity-30 z-20" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(16, 185, 129, 0.15) 50%, transparent 100%)', animation: 'shimmer 3s ease-in-out infinite' }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl z-0" />
                {(() => {
                    const total = data.advances + data.declines || 1;
                    const advPct = Math.round((data.advances / total) * 100);
                    return (
                        <>
                            <motion.div 
                                className="absolute bottom-0 left-0 right-0"
                                initial={{ height: 0 }}
                                animate={{ height: `${advPct}%` }}
                                transition={{ duration: 1.2, ease: "easeOut" }}
                            >
                                <svg className="absolute -top-3 left-0 w-[200%] h-6" viewBox="0 0 1200 30" preserveAspectRatio="none" style={{ animation: 'liquidWave 3s ease-in-out infinite' }}>
                                    <path d="M0,15 C150,30 350,0 600,15 C850,30 1050,0 1200,15 L1200,30 L0,30 Z" fill="url(#liquidGradient)" />
                                    <defs><linearGradient id="liquidGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="rgba(52, 211, 153, 0.9)" /><stop offset="100%" stopColor="rgba(16, 185, 129, 0.95)" /></linearGradient></defs>
                                </svg>
                                <div className="absolute top-3 left-0 right-0 bottom-0 bg-gradient-to-b from-emerald-400/90 via-emerald-500/95 to-emerald-600" />
                                <div className="absolute bottom-3 left-4 z-10">
                                    <span className="text-3xl font-bold text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                                        <CountUp 
                                            start={hasAnimatedInitial ? (prevData?.advances ?? data.advances) : 0}
                                            end={data.advances} 
                                            duration={downloading ? 0 : (!hasAnimatedInitial || (prevData && prevData.advances !== data.advances) ? 1.2 : 0)} 
                                            formattingFn={(Val) => formatNumber(Val)} 
                                            preserveValue 
                                            onEnd={() => !hasAnimatedInitial && setHasAnimatedInitial(true)}
                                        />
                                    </span>
                                    <p className="text-xs text-white font-semibold" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>Advancing</p>
                                </div>
                            </motion.div>
                            <div className="relative z-10 p-4">
                                <div className="flex items-start justify-between">
                                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Market Breadth</p>
                                    <div className="text-right">
                                        <span className="text-2xl font-bold text-orange-200" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                                            <CountUp 
                                                start={hasAnimatedInitial ? (prevData?.declines ?? data.declines) : 0}
                                                end={data.declines} 
                                                duration={downloading ? 0 : (!hasAnimatedInitial || (prevData && prevData.declines !== data.declines) ? 1.2 : 0)} 
                                                formattingFn={(Val) => formatNumber(Val)} 
                                                preserveValue 
                                                onEnd={() => !hasAnimatedInitial && setHasAnimatedInitial(true)}
                                            />
                                        </span>
                                        <p className="text-xs text-orange-100 font-semibold" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>Declining</p>
                                    </div>
                                </div>
                            </div>
                            <style jsx>{` @keyframes liquidWave { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-50%); } } `}</style>
                        </>
                    );
                })()}
            </motion.div>

            {/* Breadth by MCap Card */}
            <motion.div variants={itemVariants} className="relative overflow-hidden rounded-2xl border border-slate-700/50 shadow-xl h-[160px] bg-gradient-to-br from-slate-900 via-slate-800/50 to-slate-900">
                <div className="relative z-10 p-4 h-full flex flex-col">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Breadth by MCap</p>
                    <div className="flex-1 flex flex-col justify-center gap-2.5">
                        {(['Large', 'Mid', 'Small', 'Micro'] as const).map((label, idx) => {
                            const categories = ['large', 'mid', 'small', 'micro'] as const;
                            const key = categories[idx];
                            const catData = data.breadthByCategory[key];
                            const total = catData.advances + catData.declines || 1;
                            const advPercent = Math.round((catData.advances / total) * 100);
                            return (
                                <div key={key} className="flex items-center gap-2">
                                    <div className="flex-1 h-4 rounded-full relative overflow-hidden bg-red-900/40">
                                        <div className="absolute inset-0 bg-gradient-to-r from-red-900/60 to-red-800/40" />
                                        <motion.div 
                                            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-emerald-400/90 to-emerald-600 flex items-center shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${advPercent}%` }}
                                            transition={{ duration: 1, ease: "easeOut" }}
                                        />
                                        <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                                            {catData.advances > 0 ? (
                                                <span className="text-[10px] font-extrabold text-emerald-950 z-10">{catData.advances}</span>
                                            ) : <span />}
                                            {catData.declines > 0 ? (
                                                <span className="text-[10px] font-extrabold text-white drop-shadow-md z-10">{catData.declines}</span>
                                            ) : <span />}
                                        </div>
                                    </div>
                                    <span className="text-[10px] text-gray-500 w-10 font-medium">{label}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
});

export default LiveStatsCards;
