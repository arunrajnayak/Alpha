/**
 * NSE API Service
 * 
 * Handles direct fetching of historical data from NSE India website.
 * Used as a fallback when Upstox data is unavailable.
 */

import { formatDateDMY } from './format';

// ============================================================================
// Types
// ============================================================================

export interface NSEHistoricalData {
    data: {
        CH_TIMESTAMP: string;
        CH_CLOSING_PRICE: number;
        CH_SYMBOL: string;
    }[];
}

export interface NSEIndexHistoricalData {
    data: {
        indexCloseOnlineRecords: {
            EOD_TIMESTAMP: string; // "13-JAN-2025"
            EOD_CLOSE_INDEX_VAL: number;
        }[];
    } | {
        EOD_TIMESTAMP: string;
        EOD_CLOSE_INDEX_VAL: number;
    }[]; // Alternative format
}

export interface NSECorporateAction {
    symbol: string;
    series: string;
    ind: string;
    faceVal: string;
    subject: string;
    exDate: string; // "28-Jan-2025" format
    recDate: string;
    bcStartDate: string;
    bcEndDate: string;
    ndStartDate: string;
    comp: string;
    isin: string;
    ndEndDate: string;
    caBroadcastDate: string | null;
}

// Common headers for NSE requests
const NSE_HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
};

// ============================================================================
// NSE Session Management
// ============================================================================

/**
 * Get NSE session cookies required for API calls
 */
async function getNSECookies(): Promise<string | null> {
    const homeRes = await fetch('https://www.nseindia.com', { headers: NSE_HEADERS });
    return homeRes.headers.get('set-cookie');
}

// ============================================================================
// Stock History
// ============================================================================

/**
 * Fetch historical stock data from NSE
 * @param symbol Stock symbol (without exchange suffix)
 * @param startDate Start date for history
 * @param endDate End date for history
 */
export async function fetchNSEHistory(
    symbol: string, 
    startDate: Date, 
    endDate: Date
): Promise<NSEHistoricalData | null> {
    const symbolClean = symbol.replace(/\.(NS|BO)$/i, '');

    try {
        console.log(`[NSE] Initializing session for ${symbolClean}...`);

        // 1. Get Cookies
        const cookies = await getNSECookies();
        if (!cookies) throw new Error('No cookies received from NSE homepage');

        // 2. Split Date Range into chunks (NSE API often limits to ~70-100 rows)
        const chunks: { from: Date; to: Date }[] = [];
        let current = new Date(startDate);
        const end = new Date(endDate);

        while (current < end) {
            const next = new Date(current);
            next.setDate(next.getDate() + 65); // 2 months is safe

            const chunkEnd = next > end ? end : next;
            chunks.push({ from: new Date(current), to: chunkEnd });

            // Advance
            current = new Date(chunkEnd);
            current.setDate(current.getDate() + 1);
        }

        console.log(`[NSE] Fetching history for ${symbolClean} in ${chunks.length} chunks...`);

        const apiHeaders = {
            ...NSE_HEADERS,
            'Cookie': cookies,
            'Referer': `https://www.nseindia.com/get-quotes/equity?symbol=${symbolClean}`,
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest'
        };

        const allData: { CH_TIMESTAMP: string; CH_CLOSING_PRICE: number; CH_SYMBOL: string }[] = [];

        for (const chunk of chunks) {
            const chunkFrom = formatDateDMY(chunk.from);
            const chunkTo = formatDateDMY(chunk.to);
            const chunkUrl = `https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData?from=${chunkFrom}&to=${chunkTo}&symbol=${symbolClean}&type=priceVolumeDeliverable&series=ALL`;

            // Sequential fetch with delay to be polite
            await new Promise(r => setTimeout(r, 1000));

            console.log(`[NSE] Fetching chunk: ${chunkFrom} to ${chunkTo}`);
            const apiRes = await fetch(chunkUrl, { headers: apiHeaders });

            if (!apiRes.ok) {
                const txt = await apiRes.text();
                console.warn(`[NSE] Chunk failed ${apiRes.status}: ${txt.substring(0, 100)}`);
                continue;
            }

            try {
                const json = await apiRes.json() as NSEHistoricalData;
                console.log(`[NSE] Chunk Response for ${symbolClean}:`, JSON.stringify(json).substring(0, 1000));
                if (json.data && Array.isArray(json.data)) {
                    allData.push(...json.data);
                }
            } catch (e) {
                console.warn(`[NSE] Failed to parse chunk JSON`, e);
            }
        }

        if (allData.length === 0) return null;

        console.log(`[NSE] Success: ${allData.length} records found for ${symbolClean} (Total)`);
        return { data: allData };

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[NSE] Fetch failed for ${symbolClean}:`, message);
        return null;
    }
}

// ============================================================================
// Index History
// ============================================================================

/**
 * Fetch historical index data from NSE
 * @param indexName Index name (e.g., "NIFTY 50")
 * @param startDate Start date for history
 * @param endDate End date for history
 */
export async function fetchNSEIndexHistory(
    indexName: string, 
    startDate: Date, 
    endDate: Date
): Promise<NSEIndexHistoricalData | null> {
    try {
        console.log(`[NSE Index] Initializing session for ${indexName}...`);

        // 1. Get Cookies
        const cookies = await getNSECookies();
        if (!cookies) throw new Error('No cookies received from NSE homepage');

        // 2. Split Date Range into chunks (3 months each for index)
        const chunks: { from: Date; to: Date }[] = [];
        let current = new Date(startDate);
        const end = new Date(endDate);

        while (current < end) {
            const next = new Date(current);
            next.setDate(next.getDate() + 90); // 3 months chunk

            const chunkEnd = next > end ? end : next;
            chunks.push({ from: new Date(current), to: chunkEnd });

            // Advance
            current = new Date(chunkEnd);
            current.setDate(current.getDate() + 1);
        }

        console.log(`[NSE Index] Fetching history for ${indexName} in ${chunks.length} chunks...`);

        let apiHeaders = {
            ...NSE_HEADERS,
            'Cookie': cookies,
            'Referer': 'https://www.nseindia.com/reports-indices-historical-index-data',
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest'
        };

        const allData: { EOD_TIMESTAMP: string; EOD_CLOSE_INDEX_VAL: number }[] = [];

        for (const chunk of chunks) {
            const chunkFrom = formatDateDMY(chunk.from);
            const chunkTo = formatDateDMY(chunk.to);
            const chunkUrl = `https://www.nseindia.com/api/historicalOR/indicesHistory?indexType=${encodeURIComponent(indexName)}&from=${chunkFrom}&to=${chunkTo}`;

            // Sequential fetch
            await new Promise(r => setTimeout(r, 1000));

            console.log(`[NSE Index] Fetching chunk: ${chunkFrom} to ${chunkTo}`);
            let apiRes = await fetch(chunkUrl, { headers: apiHeaders });

            // Handle session refresh if needed
            if (apiRes.status === 401 || apiRes.status === 403) {
                console.log(`[NSE Index] Refreshing session for chunk...`);
                const newCookies = await getNSECookies();
                if (newCookies) {
                    apiHeaders = { ...apiHeaders, 'Cookie': newCookies };
                    apiRes = await fetch(chunkUrl, { headers: apiHeaders });
                }
            }

            if (!apiRes.ok) {
                const txt = await apiRes.text();
                console.warn(`[NSE Index] Chunk failed ${apiRes.status}: ${txt.substring(0, 100)}`);
                continue;
            }

            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const json = await apiRes.json() as any;
                
                // Handle both response structures
                if (json.data && Array.isArray(json.data.indexCloseOnlineRecords)) {
                    allData.push(...json.data.indexCloseOnlineRecords);
                } else if (json.data && Array.isArray(json.data)) {
                    allData.push(...json.data);
                }
            } catch (e) {
                console.warn(`[NSE Index] Failed to parse chunk JSON`, e);
            }
        }

        if (allData.length === 0) return null;

        console.log(`[NSE Index] Success: ${allData.length} records found for ${indexName} (Total)`);
        return { data: { indexCloseOnlineRecords: allData } };

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[NSE Index] Fetch failed for ${indexName}:`, message);
        return null;
    }
}

// ============================================================================
// Corporate Actions
// ============================================================================

/**
 * Fetch corporate actions from NSE
 * @param fromDate Start date for corporate actions
 * @param toDate End date for corporate actions
 * @returns Array of corporate actions or null on failure
 */
export async function fetchNSECorporateActions(
    fromDate: Date,
    toDate: Date
): Promise<NSECorporateAction[] | null> {
    try {
        const fromDateStr = formatDateDMY(fromDate);
        const toDateStr = formatDateDMY(toDate);
        
        console.log(`[NSE] Fetching corporate actions from ${fromDateStr} to ${toDateStr}...`);

        // 1. Get Cookies
        const cookies = await getNSECookies();
        if (!cookies) throw new Error('No cookies received from NSE homepage');

        // 2. Fetch corporate actions
        const apiHeaders = {
            ...NSE_HEADERS,
            'Cookie': cookies,
            'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest'
        };

        const apiUrl = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${fromDateStr}&to_date=${toDateStr}`;
        const apiRes = await fetch(apiUrl, { headers: apiHeaders });

        if (!apiRes.ok) {
            const txt = await apiRes.text();
            console.warn(`[NSE] Corporate actions fetch failed ${apiRes.status}: ${txt.substring(0, 100)}`);
            return null;
        }

        const json = await apiRes.json() as NSECorporateAction[];
        console.log(`[NSE] Successfully fetched ${json.length} corporate actions`);
        return json;

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[NSE] Error fetching corporate actions:`, message);
        return null;
    }
}
