/**
 * Market Holidays Cache
 * 
 * Provides efficient caching of market holidays from Upstox API
 * to avoid excessive API calls and improve performance.
 * 
 * Uses both server-side in-memory cache and client-side localStorage.
 */

import { getMarketHolidays, getMarketTimings, hasValidToken, type MarketHoliday, type MarketTiming } from './upstox-client';

// Cache structure
interface HolidaysCache {
    holidays: MarketHoliday[];
    fetchedAt: number;
    year: number;
}

interface TimingsCache {
    timings: MarketTiming[];
    date: string;
    fetchedAt: number;
}

const CACHE_KEY = 'upstox_market_holidays_cache';
const CACHE_KEY_TIMINGS = 'upstox_market_timings_cache';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Server-side in-memory cache (persists across requests in same process)
let serverHolidaysCache: HolidaysCache | null = null;
const serverTimingsCache = new Map<string, TimingsCache>();

/**
 * Get cached holidays or fetch fresh data if cache is expired
 * Uses server-side memory cache + client-side localStorage fallback
 */
async function getCachedHolidays(): Promise<MarketHoliday[]> {
    const currentYear = new Date().getFullYear();
    const now = Date.now();
    
    // 1. Try server-side in-memory cache first (works on both server and client)
    if (serverHolidaysCache && 
        serverHolidaysCache.year === currentYear && 
        (now - serverHolidaysCache.fetchedAt) < CACHE_DURATION_MS) {
        return serverHolidaysCache.holidays;
    }
    
    // 2. Try client-side localStorage (client-side only)
    if (typeof window !== 'undefined') {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const cacheData: HolidaysCache = JSON.parse(cached);
                
                // Check if cache is still valid (same year and not expired)
                if (cacheData.year === currentYear && (now - cacheData.fetchedAt) < CACHE_DURATION_MS) {
                    // Populate server cache from localStorage for future calls
                    serverHolidaysCache = cacheData;
                    return cacheData.holidays;
                }
            }
        } catch (error) {
            console.warn('[MarketHolidays] Failed to read localStorage cache:', error);
        }
    }
    
    // 3. Cache miss or expired - fetch fresh data (only if we have a valid token)
    const tokenAvailable = await hasValidToken();
    if (!tokenAvailable) {
        // No token available - return empty array silently (don't spam logs)
        // The UI will show a login prompt via the connectionError toast
        return [];
    }
    
    try {
        const holidays = await getMarketHolidays();
        
        const cacheData: HolidaysCache = {
            holidays,
            fetchedAt: Date.now(),
            year: currentYear,
        };
        
        // Update server-side cache
        serverHolidaysCache = cacheData;
        
        // Update client-side cache
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
            } catch (error) {
                console.warn('[MarketHolidays] Failed to write localStorage cache:', error);
            }
        }
        
        return holidays;
    } catch (error) {
        console.error('[MarketHolidays] Failed to fetch holidays:', error);
        return [];
    }
}

/**
 * Check if a given date is a market holiday
 * @param date Date object or YYYY-MM-DD string
 * @returns true if market is closed, false if open or unknown
 */
export async function isTradingHoliday(date: Date | string): Promise<boolean> {
    try {
        // Convert date to YYYY-MM-DD format
        const dateStr = typeof date === 'string' 
            ? date 
            : date.toISOString().split('T')[0];
        
        const holidays = await getCachedHolidays();
        
        // Find holiday for this date
        const holiday = holidays.find(h => h.date === dateStr);
        
        if (!holiday) {
            return false; // Not a holiday
        }
        
        // Check if NSE is closed (we primarily trade on NSE)
        const nseIsClosed = holiday.closed_exchanges?.includes('NSE') || 
                          holiday.closed_exchanges?.includes('NFO');
        
        // If it's a trading holiday and NSE is closed, return true
        if (holiday.holiday_type === 'TRADING_HOLIDAY' && nseIsClosed) {
            return true;
        }
        
        // If NSE is not in open_exchanges list and it's a trading holiday, assume closed
        if (holiday.holiday_type === 'TRADING_HOLIDAY') {
            const nseIsOpen = holiday.open_exchanges?.some(
                ex => ex.exchange === 'NSE' || ex.exchange === 'NFO'
            );
            return !nseIsOpen;
        }
        
        return false;
    } catch (error) {
        console.error('[MarketHolidays] Error checking if trading holiday:', error);
        // On error, assume not a holiday (fail safe)
        return false;
    }
}

/**
 * Get the holiday information for today
 * @returns Holiday object if today is a holiday, null otherwise
 */
export async function getTodayHoliday(): Promise<MarketHoliday | null> {
    try {
        const now = new Date();
        const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const today = istTime.toISOString().split('T')[0];
        
        const holidays = await getCachedHolidays();
        return holidays.find(h => h.date === today) || null;
    } catch (error) {
        console.error('[MarketHolidays] Error getting today\'s holiday:', error);
        return null;
    }
}

/**
 * Get market timings for a specific date (cached)
 * Uses server-side memory cache + client-side localStorage fallback
 * @param date YYYY-MM-DD
 */
export async function getMarketTimingsCached(date: string): Promise<MarketTiming[]> {
    const now = Date.now();
    
    // 1. Try server-side in-memory cache first
    const serverCached = serverTimingsCache.get(date);
    if (serverCached && (now - serverCached.fetchedAt) < CACHE_DURATION_MS) {
        return serverCached.timings;
    }
    
    // 2. Try client-side localStorage (client-side only)
    if (typeof window !== 'undefined') {
        try {
            const cached = localStorage.getItem(CACHE_KEY_TIMINGS);
            if (cached) {
                const cacheData: TimingsCache = JSON.parse(cached);
                // Cache is valid for same date and < 24 hours
                if (cacheData.date === date && (now - cacheData.fetchedAt) < CACHE_DURATION_MS) {
                    // Populate server cache from localStorage
                    serverTimingsCache.set(date, cacheData);
                    return cacheData.timings;
                }
            }
        } catch (error) {
            console.warn('[MarketTimings] Failed to read localStorage cache:', error);
        }
    }
    
    // 3. Fetch fresh (only if we have a valid token)
    const tokenAvailable = await hasValidToken();
    if (!tokenAvailable) {
        // No token available - return empty array silently
        return [];
    }
    
    try {
        const timings = await getMarketTimings(date);
        
        const cacheData: TimingsCache = {
            timings,
            date,
            fetchedAt: Date.now(),
        };
        
        // Update server-side cache
        serverTimingsCache.set(date, cacheData);
        
        // Clean up old entries from server cache (keep only last 7 days)
        if (serverTimingsCache.size > 7) {
            const entries = Array.from(serverTimingsCache.entries());
            entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
            for (let i = 0; i < entries.length - 7; i++) {
                serverTimingsCache.delete(entries[i][0]);
            }
        }
        
        // Update client-side cache
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(CACHE_KEY_TIMINGS, JSON.stringify(cacheData));
            } catch (error) {
                console.warn('[MarketTimings] Failed to write localStorage cache:', error);
            }
        }
        
        return timings;
    } catch (error) {
        console.error('[MarketTimings] Failed to fetch timings:', error);
        return [];
    }
}

export interface MarketStatus {
    isOpen: boolean;
    nextOpen?: Date;
    closeTime?: Date;
    reason?: string;
}

/**
 * Get the comprehensive market status for Today
 * Combines Holidays API and Timings API logic
 */
export async function getMarketStatus(): Promise<MarketStatus> {
    const now = new Date();
    // Use Indian Standard Time (IST) for date string
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const today = istTime.toISOString().split('T')[0];

    // 1. Check Holiday first
    const isHoliday = await isTradingHoliday(today);
    if (isHoliday) {
        const holiday = await getTodayHoliday();
        return { 
            isOpen: false, 
            reason: holiday ? `Holiday: ${holiday.description}` : 'Trading Holiday' 
        };
    }
    
    // 2. Check Timings API FIRST before weekend check
    // This ensures special sessions (like budget day on Sunday) are detected correctly
    try {
        const timings = await getMarketTimingsCached(today);
        
        // Find NSE timing
        const nseTiming = timings.find(t => t.exchange === 'NSE' || t.exchange === 'NFO');
        
        if (nseTiming) {
            const startTime = new Date(nseTiming.start_time); // APIs return timestamps
            const endTime = new Date(nseTiming.end_time);
            
            // Check if current time is within range
            const nowTs = Date.now(); // UTC timestamp
            const startTs = nseTiming.start_time;
            const endTs = nseTiming.end_time;
            
            if (nowTs >= startTs && nowTs < endTs) {
                return { 
                    isOpen: true, 
                    closeTime: endTime,
                    reason: 'Market is Live'
                };
            } else if (nowTs < startTs) {
                return { 
                    isOpen: false, 
                    nextOpen: startTime,
                    reason: `Market opens at ${startTime.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit'})}` 
                };
            } else {
                 // Market was open today but is now closed - include closeTime!
                 return { 
                    isOpen: false, 
                    closeTime: endTime,
                    reason: `Market closed at ${endTime.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit'})}` 
                };
            }
        }
    } catch (e) {
        console.warn('Failed to get market timings, falling back to holidays API', e);
    }
    
    // 2b. FALLBACK: Check Holidays API for special sessions (Budget Day on Sunday, etc.)
    // The holidays API can contain open_exchanges with timings for special trading days
    try {
        const holiday = await getTodayHoliday();
        if (holiday && holiday.open_exchanges) {
            const nseOpen = holiday.open_exchanges.find(
                ex => ex.exchange === 'NSE' || ex.exchange === 'NFO'
            );
            
            if (nseOpen && nseOpen.start_time && nseOpen.end_time) {
                console.log(`[MarketStatus] Using holidays API for special session: ${holiday.description}`);
                const startTime = new Date(nseOpen.start_time);
                const endTime = new Date(nseOpen.end_time);
                const nowTs = Date.now();
                
                if (nowTs >= nseOpen.start_time && nowTs < nseOpen.end_time) {
                    return { 
                        isOpen: true, 
                        closeTime: endTime,
                        reason: `Market is Live (${holiday.description})`
                    };
                } else if (nowTs < nseOpen.start_time) {
                    return { 
                        isOpen: false, 
                        nextOpen: startTime,
                        reason: `Market opens at ${startTime.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit'})} (${holiday.description})` 
                    };
                } else {
                    // Market was open today but is now closed - include closeTime!
                    return { 
                        isOpen: false, 
                        closeTime: endTime,
                        reason: `Market closed at ${endTime.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit'})} (${holiday.description})` 
                    };
                }
            }
        }
    } catch (e) {
        console.warn('Failed to check holidays API for special sessions', e);
    }
    
    // 3. Check Weekend AFTER timings API check
    // This ensures special sessions (like budget day) detected via API are still marked as open
    // But normal weekends without API data fall back to closed
    const day = istTime.getDay();
    if (day === 0 || day === 6) {
        return { isOpen: false, reason: 'Market closed on weekends' };
    }
    
    // 4. Fallback Static Logic (9:15 - 15:30) - only for weekdays with no timings
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    const startMinutes = 9 * 60 + 15; // 9:15 AM
    const endMinutes = 15 * 60 + 30;  // 3:30 PM
    
    if (totalMinutes >= startMinutes && totalMinutes < endMinutes) {
        return { isOpen: true, reason: 'Market is Live (Static Schedule)' };
    }
    
    return { isOpen: false, reason: 'Market Closed (Static Schedule)' };
}

/**
 * Clear the holidays cache (useful for testing or manual refresh)
 * Clears both server-side memory cache and client-side localStorage
 */
export function clearHolidaysCache(): void {
    // Clear server-side cache
    serverHolidaysCache = null;
    serverTimingsCache.clear();
    
    // Clear client-side cache
    if (typeof window !== 'undefined') {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_KEY_TIMINGS);
    }
}
