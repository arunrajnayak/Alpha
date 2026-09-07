'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faRotateRight, faCalendar } from '@fortawesome/free-solid-svg-icons';

import type { Variants } from 'framer-motion';

interface LiveHeaderProps {
    marketOpen: boolean;
    lastRefreshed: Date | null;
    loading: boolean;
    downloading: boolean;
    isMobile: boolean;
    onRefresh: () => void;
    onDownloadSnapshot: () => void;
    itemVariants: Variants;
    marketStatus?: 'OPEN' | 'CLOSED' | 'PRE_OPEN' | 'UNKNOWN';
    dataDate?: string;
}

const LiveHeader = memo(function LiveHeader({
    marketOpen,
    lastRefreshed,
    loading,
    downloading,
    isMobile,
    onRefresh,
    onDownloadSnapshot,
    itemVariants,
    marketStatus,
    dataDate
}: LiveHeaderProps) {
    const isClosed = marketStatus === 'CLOSED';
    const isPreOpen = marketStatus === 'PRE_OPEN';
    
    // Format data date if available
    const formattedDataDate = dataDate ? new Date(dataDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    }) : null;
    
    // Check if data is from a previous day (not today in IST)
    const isHistoricalData = dataDate ? (() => {
        const dataDateObj = new Date(dataDate);
        // Get today's date in IST
        const now = new Date();
        const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const todayIST = `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')}`;
        // Get data date in IST (not UTC) for consistent comparison
        const dataDateIST = new Date(dataDateObj.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const dataDateStr = `${dataDateIST.getFullYear()}-${String(dataDateIST.getMonth() + 1).padStart(2, '0')}-${String(dataDateIST.getDate()).padStart(2, '0')}`;
        return dataDateStr !== todayIST;
    })() : false;

    return (
        <motion.div className="space-y-6" variants={itemVariants}>
            <div className="flex flex-row items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap">
                            <span className="gradient-text">
                                {isPreOpen
                                    ? 'Pre-Open Session'
                                    : isClosed 
                                        ? (isHistoricalData ? 'Last Trading Day' : 'Market Closed')
                                        : (marketOpen ? 'Market Live' : 'Market Today')}
                            </span>
                        </h1>
                    </div>
                    {isPreOpen && (
                        <div className="flex items-center gap-2 text-xs md:text-sm text-amber-300/80">
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                            <span>Indicative equilibrium prices from exchange call auction (9:00–9:15 AM IST)</span>
                        </div>
                    )}
                    {isClosed && formattedDataDate && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                             <FontAwesomeIcon icon={faCalendar} className="w-3 h-3 text-gray-500" />
                             <span>{isHistoricalData ? `Showing ${formattedDataDate}'s Performance` : `Data from ${formattedDataDate} (Closing Prices)`}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 bg-slate-800/40 backdrop-blur-md border border-white/5 rounded-2xl p-1.5 shadow-lg">
                    {/* Last Updated - Desktop only */}
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 border-r border-white/5 mr-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            isPreOpen
                                ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                                : isClosed 
                                    ? 'bg-orange-500' 
                                    : 'bg-emerald-500'
                        } ${marketOpen && !isClosed && !isPreOpen ? 'animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : ''}`}></div>
                        <p className="text-gray-400 text-xs font-medium">
                            {lastRefreshed && (() => {
                                const rounded = new Date(lastRefreshed);
                                const seconds = rounded.getSeconds();
                                rounded.setSeconds(seconds < 15 ? 0 : seconds < 45 ? 30 : 0);
                                rounded.setMilliseconds(0);
                                return (
                                    <span className="flex items-center gap-1">
                                        Updated 
                                        <motion.span
                                            key={rounded.getTime()}
                                            initial={{ opacity: 0.2 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ duration: 0.5 }}
                                            className="text-gray-300"
                                        >
                                            {rounded.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                        </motion.span>
                                    </span>
                                );
                            })()}
                        </p>
                    </div>

                    {/* Action Buttons Group */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={onRefresh}
                            disabled={loading}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-transparent transition-all cursor-pointer disabled:opacity-50"
                            title="Refresh Now"
                        >
                            <FontAwesomeIcon icon={faRotateRight} className={`w-2 h-2 ${loading ? 'animate-spin' : ''}`} />
                        </button>

                        <button
                            id="snapshot-download-btn"
                            onClick={onDownloadSnapshot}
                            disabled={downloading}
                            className="snapshot-hide w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-transparent transition-all disabled:opacity-50 cursor-pointer"
                            title="Download Snapshot"
                        >
                            {downloading ? (
                                <div className="w-2 h-2 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                            ) : (
                                <FontAwesomeIcon icon={faCamera} className="w-2 h-2" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
});

export default LiveHeader;
