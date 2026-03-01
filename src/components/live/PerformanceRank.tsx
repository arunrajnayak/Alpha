'use client';

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faScaleBalanced } from '@fortawesome/free-solid-svg-icons';
import type { Variants } from 'framer-motion';

interface IndexData {
    name: string;
    symbol: string;
    percentChange: number;
    currentPrice: number;
}

interface PerformanceRankProps {
    dayGainPercent: number;
    indices: IndexData[];
    itemVariants: Variants;
}

const PerformanceRank = memo(function PerformanceRank({
    dayGainPercent,
    indices,
    itemVariants
}: PerformanceRankProps) {
    // Combine portfolio with indices and sort by performance
    const allItems = [
        { name: 'My Portfolio', symbol: 'PORTFOLIO', percentChange: dayGainPercent, isPortfolio: true },
        ...(indices?.map(i => ({ ...i, isPortfolio: false })) || [])
    ];
    allItems.sort((a, b) => b.percentChange - a.percentChange);

    return (
        <motion.div variants={itemVariants} className="bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                <h3 className="text-lg font-semibold text-blue-400 flex items-center gap-2">
                    <FontAwesomeIcon icon={faScaleBalanced} /> Performance Rank
                </h3>
            </div>
            <div className="p-2">
                <div className="space-y-1">
                    {allItems.length <= 1 ? (
                        <p className="text-center py-8 text-gray-500">Loading indices...</p>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {allItems.map((item, index) => (
                                <motion.div 
                                    key={item.symbol} 
                                    layout 
                                    initial={{ opacity: 0, x: -20 }} 
                                    animate={{ opacity: 1, x: 0 }} 
                                    exit={{ opacity: 0, x: 20 }} 
                                    transition={{ duration: 0.3 }} 
                                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors ${
                                        item.isPortfolio 
                                            ? 'bg-blue-500/10 border border-blue-500/30' 
                                            : 'hover:bg-white/5 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                            item.isPortfolio 
                                                ? 'bg-blue-50 text-slate-900' 
                                                : 'bg-white/10 text-gray-400'
                                        }`}>
                                            {index + 1}
                                        </div>
                                        <div>
                                            <h4 className={`font-semibold text-sm ${
                                                item.isPortfolio ? 'text-blue-200' : 'text-white'
                                            }`}>
                                                {item.name}
                                            </h4>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className={`font-bold ${
                                            item.percentChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}>
                                            {item.percentChange > 0 ? '+' : ''}{item.percentChange.toFixed(2)}%
                                        </span>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>
        </motion.div>
    );
});

export default PerformanceRank;
