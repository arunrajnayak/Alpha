'use client';

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowTrendUp, faArrowTrendDown, faScaleBalanced } from '@fortawesome/free-solid-svg-icons';
import { formatCurrency } from '@/lib/format';
import { LiveStockData } from '@/app/actions/live';
import type { Variants } from 'framer-motion';

interface LiveMoversProps {
    topGainers: LiveStockData[];
    topLosers: LiveStockData[];
    privacyMode: boolean;
    isMobile: boolean;
    itemVariants: Variants;
}

const LiveMovers = memo(function LiveMovers({
    topGainers,
    topLosers,
    privacyMode,
    isMobile,
    itemVariants
}: LiveMoversProps) {
    const validGainers = topGainers.filter(stock => stock.dayChangePercent > 0);
    const validLosers = topLosers.filter(stock => stock.dayChangePercent < 0);

    return (
        <>
            {/* Top Gainers */}
            <motion.div variants={itemVariants} className="bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <h3 className="text-lg font-semibold text-green-400 flex items-center gap-2">
                        <FontAwesomeIcon icon={faArrowTrendUp} /> Top Gainers
                    </h3>
                </div>
                <div className="p-2">
                    <AnimatePresence mode="popLayout">
                        {validGainers.map((stock, index) => (
                            <motion.div 
                                key={stock.symbol} 
                                layout 
                                initial={{ opacity: 0, y: 20 }} 
                                animate={{ opacity: 1, y: 0 }} 
                                exit={{ opacity: 0, y: -20 }} 
                                transition={{ duration: 0.3, delay: index * 0.05 }} 
                                className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                        <span className="text-emerald-400 text-sm font-bold">{index + 1}</span>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-white text-sm">{stock.symbol}</h4>
                                        <span className="text-xs text-gray-500">{formatCurrency(stock.currentPrice, 2, 2)}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className={`block font-bold ${stock.dayChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {stock.dayChangePercent > 0 ? '+' : ''}{stock.dayChangePercent.toFixed(2)}%
                                    </span>
                                    <span className={`text-xs ${stock.dayChange >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                                        {privacyMode && !isMobile ? '****' : (
                                            <>{stock.dayChange > 0 ? '+' : ''}{formatCurrency(stock.dayChange * stock.quantity, 0, 0)}</>
                                        )}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {validGainers.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-500 opacity-50">
                            <FontAwesomeIcon icon={faScaleBalanced} className="text-3xl mb-2" />
                            <p className="text-sm">No gainers today</p>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Top Losers */}
            <motion.div variants={itemVariants} className="bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <h3 className="text-lg font-semibold text-red-400 flex items-center gap-2">
                        <FontAwesomeIcon icon={faArrowTrendDown} /> Top Losers
                    </h3>
                </div>
                <div className="p-2">
                    <AnimatePresence mode="popLayout">
                        {validLosers.map((stock, index) => (
                            <motion.div 
                                key={stock.symbol} 
                                layout 
                                initial={{ opacity: 0, y: 20 }} 
                                animate={{ opacity: 1, y: 0 }} 
                                exit={{ opacity: 0, y: -20 }} 
                                transition={{ duration: 0.3, delay: index * 0.05 }} 
                                className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                                        <span className="text-red-400 text-sm font-bold">{index + 1}</span>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-white text-sm">{stock.symbol}</h4>
                                        <span className="text-xs text-gray-500">{formatCurrency(stock.currentPrice, 2, 2)}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block font-bold text-red-400">
                                        {stock.dayChangePercent.toFixed(2)}%
                                    </span>
                                    <span className="text-xs text-red-400/70">
                                        {privacyMode && !isMobile ? '****' : formatCurrency(stock.dayChange * stock.quantity, 0, 0)}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {validLosers.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-500 opacity-50">
                            <FontAwesomeIcon icon={faScaleBalanced} className="text-3xl mb-2" />
                            <p className="text-sm">No losers today</p>
                        </div>
                    )}
                </div>
            </motion.div>
        </>
    );
});

export default LiveMovers;
