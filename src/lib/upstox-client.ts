/**
 * Upstox Client
 * 
 * Handles Upstox API interactions using tokens stored in the database.
 * Tokens are obtained via the semi-automated flow:
 * 1. Cron job requests token daily
 * 2. User approves via phone notification
 * 3. Token is delivered to webhook and stored in DB
 */

import {
    getAccessToken,
    clearTokenCache,
} from './upstox/auth';

// Configuration from environment
const CONFIG = {
    apiKey: process.env.UPSTOX_API_KEY,
    apiSecret: process.env.UPSTOX_API_SECRET,
    baseUrl: 'https://api.upstox.com/v2',
    baseUrlV3: 'https://api.upstox.com/v3',
};

// ============================================================================
// Types
// ============================================================================

export interface UpstoxQuote {
    instrument_token: string;
    symbol: string;
    last_price: number;
    volume: number;
    average_price: number;
    ohlc: {
        open: number;
        high: number;
        low: number;
        close: number;
    };
    net_change: number;
    total_buy_quantity: number;
    total_sell_quantity: number;
    lower_circuit_limit: number;
    upper_circuit_limit: number;
    last_trade_time: string;
    oi?: number;
    oi_day_high?: number;
    oi_day_low?: number;
}

export interface UpstoxLTP {
    instrument_token: string;
    symbol: string;
    last_price: number;
}

export interface UpstoxCandle {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    oi: number;
}

export interface MarketIndex {
    name: string;
    symbol: string;
    percentChange: number;
    currentPrice: number;
}

export interface MarketHoliday {
    date: string; // YYYY-MM-DD
    description: string;
    holiday_type: 'TRADING_HOLIDAY' | 'SETTLEMENT_HOLIDAY' | 'SPECIAL_TIMING';
    closed_exchanges: string[];
    open_exchanges: {
        exchange: string;
        start_time: number;
        end_time: number;
    }[];
}

export interface MarketTiming {
    exchange: string;
    start_time: number;
    end_time: number;
}

// ============================================================================
// Token Management — Re-exported from upstox/auth.ts (single source of truth)
// ============================================================================
export {
    getStoredToken,
    clearTokenCache,
    getAccessToken,
    hasValidToken,
    getTokenStatus,
    validateConfig as validateUpstoxConfig,
} from './upstox/auth';

// ============================================================================
// Historical Data (No Auth Required for V3)
// ============================================================================

/**
 * Fetch Historical Candle Data using V3 API
 * V3 URL format: /v3/historical-candle/{instrumentKey}/{unit}/{interval}/{to_date}/{from_date}
 * 
 * @param instrumentKey - Upstox instrument key (e.g., NSE_EQ|INE002A01018)
 * @param interval - Time interval: '1minute', '30minute', 'day', 'week', 'month'
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 */
export async function getHistoricalCandles(
    instrumentKey: string,
    interval: '1minute' | '30minute' | 'day' | 'week' | 'month',
    fromDate: string, // YYYY-MM-DD
    toDate: string    // YYYY-MM-DD
): Promise<{ candles: UpstoxCandle[] }> {
    const accessToken = await getAccessToken();
    
    // URL encode the instrument key (contains | character)
    const encodedKey = encodeURIComponent(instrumentKey);
    
    // V3 API uses plural unit names: minutes, hours, days, weeks, months
    // Interval is a numeric string: "1", "30", etc.
    let unit: string;
    let intervalValue: string;

    switch (interval) {
        case '1minute':
            unit = 'minutes';
            intervalValue = '1';
            break;
        case '30minute':
            unit = 'minutes';
            intervalValue = '30';
            break;
        case 'day':
            unit = 'days';
            intervalValue = '1';
            break;
        case 'week':
            unit = 'weeks';
            intervalValue = '1';
            break;
        case 'month':
            unit = 'months';
            intervalValue = '1';
            break;
        default:
            unit = 'days';
            intervalValue = '1';
    }

    // V3 URL: /v3/historical-candle/{instrumentKey}/{unit}/{interval}/{to_date}/{from_date}
    const url = `${CONFIG.baseUrlV3}/historical-candle/${encodedKey}/${unit}/${intervalValue}/${toDate}/${fromDate}`;
    
    console.log(`[Upstox] Historical candle request: ${url}`);
    
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Upstox] Historical fetch failed for ${instrumentKey}:`, errorText);
        throw new Error(`Upstox Historical Fetch Failed: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    
    // Transform candle array format to object format
    // API returns: { data: { candles: [[timestamp, open, high, low, close, volume, oi], ...] } }
    const candles: UpstoxCandle[] = (json.data?.candles || []).map((c: (string | number)[]) => ({
        timestamp: c[0] as string,
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
        oi: c[6] as number,
    }));

    console.log(`[Upstox] Got ${candles.length} candles for ${instrumentKey}`);

    return { candles };
}

// ============================================================================
// Live Market Data (Auth Required)
// ============================================================================

export interface UpstoxLiveQuoteV3 {
    last_price: number;
    instrument_token: string;
    previous_close: number;
    timestamp?: number;
}

// chunkArray imported from db.ts (single source of truth)
import { chunkArray } from './db';

/**
 * Get Live Quotes (LTP + Previous Close) for multiple instruments (V3)
 * Uses LTP V3 endpoint which is lightweight and provides 'cp' (Close Price)
 * Handles batching (Max 500 instruments per call)
 * 
 * IMPORTANT: Upstox response keys use colon format (NSE_EQ:RELIANCE) but we request
 * with pipe format (NSE_EQ|INE002A01018). We need to map both directions.
 */
export async function getLiveQuoteV3(instrumentKeys: string[], retryOnAuth = true): Promise<Map<string, UpstoxLiveQuoteV3>> {
    const accessToken = await getAccessToken();
    const result = new Map<string, UpstoxLiveQuoteV3>();
    
    // Build a lookup map: colon-format -> original request key
    // This helps us map response keys back to the keys we requested with
    const requestKeyLookup = new Map<string, string>();
    for (const key of instrumentKeys) {
        // Convert pipe to colon for lookup: NSE_EQ|INE002A01018 -> NSE_EQ:INE002A01018
        const colonKey = key.replace(/\|/g, ':');
        requestKeyLookup.set(colonKey, key);
        requestKeyLookup.set(key, key); // Also map original to itself
    }
    
    // Upstox V3 Limit: 500 instruments per LTP request
    const BATCH_SIZE = 500;
    const batches = chunkArray(instrumentKeys, BATCH_SIZE);
    
    for (const batch of batches) {
        const url = `${CONFIG.baseUrlV3}/market-quote/ltp?instrument_key=${batch.map(k => encodeURIComponent(k)).join(',')}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Upstox] LTP V3 fetch failed:`, errorText);
                
                // If we get a 401 and haven't retried yet, clear cache and retry once
                if (response.status === 401 && retryOnAuth) {
                    console.log('[Upstox] Got 401, clearing cache and retrying with fresh token...');
                    clearTokenCache();
                    // Retry once with fresh token from database
                    return getLiveQuoteV3(instrumentKeys, false);
                }
                
                throw new Error(`Upstox V3 LTP Fetch Failed: ${response.status} - ${errorText}`);
            }

            const json = await response.json();
            
            // Response format: { status: "success", data: { "NSE_EQ:RELIANCE": { last_price: ..., cp: ..., instrument_token: "NSE_EQ|INE..." } } }
            if (json.data) {
                for (const [responseKey, val] of Object.entries(json.data)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const value = val as any;
                    
                    // Try multiple strategies to find the original request key:
                    // 1. Use instrument_token from response (most reliable)
                    // 2. Look up the response key in our lookup map
                    // 3. Convert colon to pipe format
                    let mappedKey = value.instrument_token;
                    
                    if (!mappedKey) {
                        mappedKey = requestKeyLookup.get(responseKey);
                    }
                    
                    if (!mappedKey) {
                        mappedKey = responseKey.replace(/:/g, '|');
                    }
                    
                    result.set(mappedKey, {
                        last_price: value.last_price,
                        instrument_token: value.instrument_token || mappedKey,
                        previous_close: value.cp, // 'cp' is Previous Close (Close Price)
                        timestamp: value.ltt ? parseInt(value.ltt, 10) : undefined
                    });
                    
                    // Also store with the response key format for flexibility
                    if (responseKey !== mappedKey) {
                        result.set(responseKey.replace(/:/g, '|'), {
                            last_price: value.last_price,
                            instrument_token: value.instrument_token || mappedKey,
                            previous_close: value.cp,
                            timestamp: value.ltt ? parseInt(value.ltt, 10) : undefined
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[Upstox] Batch fetch failed for ${batch.length} instruments:`, error);
            throw error;
        }
    }

    return result;
}

/**
 * Get Last Traded Price for multiple instruments
 * Lightweight endpoint for bulk price checks
 * Refactored to use V3 LTP endpoint internally
 */
export async function getLTP(instrumentKeys: string[]): Promise<Map<string, number>> {
    try {
        const quotes = await getLiveQuoteV3(instrumentKeys);
        const result = new Map<string, number>();
        
        for (const [key, quote] of quotes.entries()) {
            result.set(key, quote.last_price);
        }
        
        return result;
    } catch (error) {
        console.error('[Upstox] getLTP fallback failed:', error);
        throw error;
    }
}

/**
 * Get Full Market Quote for multiple instruments
 * Uses V2 endpoint which includes OHLC, volume, circuit limits, etc.
 * 
 * Note: V3 has a different endpoint structure. For full quotes, V2 is still used
 * as it provides more comprehensive data in a single call.
 */
export async function getFullQuote(instrumentKeys: string[]): Promise<Map<string, UpstoxQuote>> {
    const accessToken = await getAccessToken();
    
    // Build lookup map for key normalization
    const requestKeyLookup = new Map<string, string>();
    for (const key of instrumentKeys) {
        const colonKey = key.replace(/\|/g, ':');
        requestKeyLookup.set(colonKey, key);
        requestKeyLookup.set(key, key);
    }
    
    const url = `${CONFIG.baseUrl}/market-quote/quotes?instrument_key=${instrumentKeys.map(k => encodeURIComponent(k)).join(',')}`;
    
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Upstox] Full quote fetch failed:`, errorText);
        throw new Error(`Upstox Quote Fetch Failed: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    const result = new Map<string, UpstoxQuote>();
    
    if (json.data) {
        for (const [responseKey, value] of Object.entries(json.data)) {
            // Normalize key: API returns colon-separated keys (NSE_INDEX:Nifty 50)
            // but we request with pipe-separated keys (NSE_INDEX|Nifty 50)
            const normalizedKey = responseKey.replace(/:/g, '|');
            
            // Try to find the original request key
            const originalKey = requestKeyLookup.get(responseKey) || 
                               requestKeyLookup.get(normalizedKey) || 
                               normalizedKey;
            
            result.set(originalKey, value as UpstoxQuote);
            
            // Also store with normalized key if different
            if (normalizedKey !== originalKey) {
                result.set(normalizedKey, value as UpstoxQuote);
            }
        }
    }

    return result;
}

/**
 * Get OHLC data for multiple instruments using V3 API
 * V3 provides live_ohlc and prev_ohlc with better granularity
 * 
 * @param instrumentKeys - Array of instrument keys
 * @param interval - OHLC interval: '1d' (daily), 'I1' (1-minute), 'I30' (30-minute)
 */
export async function getOHLC(
    instrumentKeys: string[], 
    interval: '1d' | 'I1' | 'I30' = '1d'
): Promise<Map<string, { open: number; high: number; low: number; close: number; volume?: number }>> {
    const accessToken = await getAccessToken();
    
    // Build lookup map for key normalization
    const requestKeyLookup = new Map<string, string>();
    for (const key of instrumentKeys) {
        const colonKey = key.replace(/\|/g, ':');
        requestKeyLookup.set(colonKey, key);
        requestKeyLookup.set(key, key);
    }
    
    // Use V3 OHLC endpoint
    const url = `${CONFIG.baseUrlV3}/market-quote/ohlc?instrument_key=${instrumentKeys.map(k => encodeURIComponent(k)).join(',')}&interval=${interval}`;
    
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Upstox] OHLC V3 fetch failed:`, errorText);
        throw new Error(`Upstox OHLC Fetch Failed: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    const result = new Map<string, { open: number; high: number; low: number; close: number; volume?: number }>();
    
    // V3 Response format:
    // { data: { "NSE_EQ:SYMBOL": { last_price, instrument_token, live_ohlc: { open, high, low, close, volume, ts }, prev_ohlc: {...} } } }
    if (json.data) {
        for (const [responseKey, value] of Object.entries(json.data)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = value as any;
            
            // Prefer live_ohlc, fall back to prev_ohlc
            const ohlc = data.live_ohlc || data.prev_ohlc;
            
            if (ohlc) {
                const normalizedKey = responseKey.replace(/:/g, '|');
                const originalKey = requestKeyLookup.get(responseKey) || 
                                   requestKeyLookup.get(normalizedKey) || 
                                   normalizedKey;
                
                result.set(originalKey, {
                    open: ohlc.open,
                    high: ohlc.high,
                    low: ohlc.low,
                    close: ohlc.close,
                    volume: ohlc.volume
                });
                
                // Also store with normalized key if different
                if (normalizedKey !== originalKey) {
                    result.set(normalizedKey, {
                        open: ohlc.open,
                        high: ohlc.high,
                        low: ohlc.low,
                        close: ohlc.close,
                        volume: ohlc.volume
                    });
                }
            }
        }
    }

    return result;
}

// ============================================================================
// Index Quotes
// ============================================================================

// Index instrument keys for common indices (exact names from Upstox API)
// IMPORTANT: These must match EXACTLY what Upstox instrument master returns - case sensitive!
// Verified from: https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
export const INDEX_KEYS = {
    'Nifty 50': 'NSE_INDEX|Nifty 50',
    'Nifty Midcap 100': 'NSE_INDEX|NIFTY MIDCAP 100',      // UPPERCASE
    'Nifty Smallcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',    // UPPERCASE, SMLCAP not SMALLCAP
    'Nifty Microcap 250': 'NSE_INDEX|NIFTY MICROCAP250',   // UPPERCASE, no space before 250
    'Nifty 500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50', // No spaces, Momentm not Momentum
    'Nifty Bank': 'NSE_INDEX|Nifty Bank',
    'Nifty IT': 'NSE_INDEX|Nifty IT',
    'Nifty Next 50': 'NSE_INDEX|Nifty Next 50',
} as const;

/**
 * Get quotes for major market indices
 * Uses LTP V3 endpoint which provides last_price and previous close (cp)
 */
export async function getIndexQuotes(): Promise<MarketIndex[]> {
    const indexNames = Object.keys(INDEX_KEYS).slice(0, 5) as (keyof typeof INDEX_KEYS)[];
    const indexKeys = indexNames.map(name => INDEX_KEYS[name]);
    
    try {
        console.log('[Indices] Fetching quotes for:', indexNames);
        console.log('[Indices] Using keys:', indexKeys);
        
        // Use LTP V3 which provides both last_price and cp (previous close)
        const quotes = await getLiveQuoteV3(indexKeys);
        const results: MarketIndex[] = [];

        console.log('[Indices] Response keys:', Array.from(quotes.keys()));
        console.log('[Indices] Got', quotes.size, 'quotes');

        // Track which quotes we've already used to avoid duplicates
        const usedQuotes = new Set<string>();

        for (let i = 0; i < indexNames.length; i++) {
            const name = indexNames[i];
            const key = indexKeys[i];
            
            // Try to find the quote with exact key match first
            let quote = quotes.get(key);
            let matchedKey: string = key;
            
            if (!quote) {
                // Try with colon format
                const colonKey = key.replace(/\|/g, ':');
                quote = quotes.get(colonKey);
                if (quote) matchedKey = colonKey;
            }
            
            // Only use partial matching if we haven't found an exact match
            // AND make sure we don't reuse the same quote for multiple indices
            if (!quote) {
                for (const [qKey, qVal] of quotes.entries()) {
                    if (usedQuotes.has(qKey)) continue; // Skip already used quotes
                    
                    // Extract the index name from the key for matching
                    const keyParts = qKey.split('|');
                    const qIndexName = keyParts[1] || '';
                    
                    // Check if this quote matches our target index
                    if (qIndexName.toLowerCase().includes(name.toLowerCase().replace(/ /g, '').substring(0, 8))) {
                        quote = qVal;
                        matchedKey = qKey;
                        break;
                    }
                }
            }
            
            if (quote && !usedQuotes.has(matchedKey)) {
                usedQuotes.add(matchedKey);
                
                const lastPrice = quote.last_price;
                const prevClose = quote.previous_close || lastPrice;
                const change = lastPrice - prevClose;
                const percentChange = prevClose > 0 ? (change / prevClose) * 100 : 0;
                
                results.push({
                    name,
                    symbol: key,
                    currentPrice: lastPrice,
                    percentChange,
                });
                console.log(`[Indices] ${name}: ${lastPrice} (${percentChange.toFixed(2)}%) [matched: ${matchedKey}]`);
            } else {
                console.warn(`[Indices] No quote found for ${name} (key: ${key})`);
            }
        }

        return results;
    } catch (error) {
        console.error('[Upstox] Failed to fetch index quotes:', error);
        return [];
    }
}

// ============================================================================
// Market Holidays
// ============================================================================

/**
 * Get market holidays for the current year or check a specific date
 * @param date Optional date in YYYY-MM-DD format to check specific date
 * @returns Array of holidays if no date specified, or single holiday object for specific date
 */
export async function getMarketHolidays(date?: string): Promise<MarketHoliday[]> {
    const accessToken = await getAccessToken();
    
    const url = date 
        ? `${CONFIG.baseUrl}/market/holidays/${date}`
        : `${CONFIG.baseUrl}/market/holidays`;
    
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upstox Market Holidays Fetch Failed: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    
    // API returns: { status: "success", data: [...holidays] } or { status: "success", data: {...single holiday} }
    if (json.status === 'success' && json.data) {
        return Array.isArray(json.data) ? json.data : [json.data];
    }
    
    return [];
}

/**
 * Check if a specific date is a trading holiday
 * @param date Date in YYYY-MM-DD format
 * @returns true if market is closed for trading, false if open
 */
export async function isMarketHoliday(date: string): Promise<boolean> {
    try {
        const holidays = await getMarketHolidays(date);
        
        if (holidays.length === 0) {
            return false; // No holiday found for this date
        }
        
        const holiday = holidays[0];
        
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
        console.error('[Upstox] Error checking market holiday:', error);
        // On error, assume not a holiday (fail open to time-based logic)
        return false;
    }
}

/**
 * Get market timings for a specific date
 * Useful for checking special trading sessions (e.g. Muhurat trading)
 * @param date YYYY-MM-DD
 */
export async function getMarketTimings(date: string): Promise<MarketTiming[]> {
    const accessToken = await getAccessToken();
    
    // Check local cache first avoiding circular dependency is tricky here if we put it in this file
    // So we will rely on the caller to handle caching (market-holidays-cache.ts)
    
    const url = `${CONFIG.baseUrl}/market/timings/${date}`;
    
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upstox Market Timings Fetch Failed: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    
    if (json.status === 'success' && json.data) {
        return json.data;
    }
    
    return [];
}

// ============================================================================
// Legacy Export (for backward compatibility during migration)
// ============================================================================

/**
 * @deprecated Use getFullQuote instead
 */
export async function getMarketQuote(instrumentKeys: string[]): Promise<unknown> {
    return Object.fromEntries(await getFullQuote(instrumentKeys));
}
