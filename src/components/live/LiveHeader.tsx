'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faRotateRight, faEye, faEyeSlash, faTag, faCalendar } from '@fortawesome/free-solid-svg-icons';

import type { Variants } from 'framer-motion';

interface LiveHeaderProps {
    marketOpen: boolean;
    lastRefreshed: Date | null;
    loading: boolean;
    downloading: boolean;
    privacyMode: boolean;
    showDynamicTitle: boolean;
    isMobile: boolean;
    onRefresh: () => void;
    onDownloadSnapshot: () => void;
    onTogglePrivacy: () => void;
    onToggleDynamicTitle: () => void;
    itemVariants: Variants;
    marketStatus?: 'OPEN' | 'CLOSED' | 'UNKNOWN';
    dataDate?: string;
}

const LiveHeader = memo(function LiveHeader({
    marketOpen,
    lastRefreshed,
    loading,
    downloading,
    privacyMode,
    showDynamicTitle,
    isMobile,
    onRefresh,
    onDownloadSnapshot,
    onTogglePrivacy,
    onToggleDynamicTitle,
    itemVariants,
    marketStatus,
    dataDate
}: LiveHeaderProps) {
    const isClosed = marketStatus === 'CLOSED';
    
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
        // Get data date as YYYY-MM-DD string
        const dataDateStr = dataDateObj.toISOString().split('T')[0];
        return dataDateStr !== todayIST;
    })() : false;

    return (
        <motion.div className="space-y-6" variants={itemVariants}>
            <div className="flex flex-row items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap">
                            <span className="gradient-text">
                                {isClosed 
                                    ? (isHistoricalData ? 'Last Trading Day' : 'Market Closed')
                                    : (marketOpen ? 'Market Live' : 'Market Today')}
                            </span>
                        </h1>
                    </div>
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
                        <div className={`w-1.5 h-1.5 rounded-full ${isClosed ? 'bg-orange-500' : 'bg-emerald-500'} ${marketOpen && !isClosed ? 'animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : ''}`}></div>
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
                        {!isMobile && (
                            <>
                                <button
                                    onClick={onTogglePrivacy}
                                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
                                        privacyMode 
                                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' 
                                            : 'bg-white/5 hover:bg-white/10 text-gray-500 border border-transparent'
                                    }`}
                                    title={privacyMode ? "Show Values" : "Hide Values"}
                                >
                                    <FontAwesomeIcon icon={privacyMode ? faEyeSlash : faEye} className="w-2 h-2" />
                                </button>

                                <button
                                    onClick={onToggleDynamicTitle}
                                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
                                        showDynamicTitle 
                                            ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' 
                                            : 'bg-white/5 hover:bg-white/10 text-gray-500 border border-transparent'
                                    }`}
                                    title={showDynamicTitle ? "Disable Dynamic Title" : "Enable Dynamic Title"}
                                >
                                    <FontAwesomeIcon icon={faTag} className="w-2 h-2" />
                                </button>
                            </>
                        )}

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
