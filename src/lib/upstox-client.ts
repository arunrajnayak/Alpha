/**
 * Upstox Client (Legacy Facade)
 *
 * Re-exports the canonical Upstox client implementation from `@/lib/upstox`.
 * All underlying network calls and token management are handled by the canonical modules:
 * - Token management: `src/lib/upstox/auth.ts`
 * - REST API client: `src/lib/upstox/client.ts`
 * - Market information: `src/lib/upstox/market-info.ts`
 * - Instrument mappings: `src/lib/instrument-service.ts`
 */

import { upstoxLogger } from '@/lib/logger';
import {
    getHistoricalCandles,
    getIntradayCandles,
    getLiveQuotes,
    getLTP,
    getFullQuotes,
    getOHLC,
    getIndexQuotes,
    INDEX_KEYS,
} from './upstox/client';

// ============================================================================
// Types — Re-exported from upstox/types.ts
// ============================================================================
export type {
    UpstoxFullQuote as UpstoxQuote,
    UpstoxLiveQuote as UpstoxLiveQuoteV3,
    UpstoxCandle,
    MarketIndex,
    MarketHoliday,
    MarketTiming,
    UpstoxExchangeStatus,
    CASEligibleStatus,
    CASStatus,
} from './upstox/types';

export interface UpstoxLTP {
    instrument_token: string;
    symbol: string;
    last_price: number;
}

// ============================================================================
// Token Management — Re-exported from upstox/auth.ts
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
// API Client Functions — Re-exported from upstox/client.ts
// ============================================================================
export {
    getHistoricalCandles,
    getIntradayCandles,
    getLiveQuotes,
    getLiveQuotes as getLiveQuoteV3,
    getLTP,
    getFullQuotes,
    getFullQuotes as getFullQuote,
    getOHLC,
    getIndexQuotes,
    INDEX_KEYS,
};

// ============================================================================
// Market Info — Re-exported from upstox/market-info.ts
// ============================================================================
export { getMarketHolidays, getMarketTimings, getExchangeStatus } from './upstox/market-info';

/**
 * Check if a specific date is a trading holiday.
 * @deprecated Import `isTradingHoliday` from '@/lib/upstox/market-info' instead.
 *
 * NOTE: This thin wrapper preserves backward compatibility. It checks only string dates
 * (not Date objects) and queries the Upstox API per-date (no year-level caching).
 */
export async function isMarketHoliday(date: string): Promise<boolean> {
    try {
        const { getMarketHolidays: _getHolidays } = await import('./upstox/market-info');
        const holidays = await _getHolidays(date);

        if (holidays.length === 0) return false;

        const holiday = holidays[0];

        const nseIsClosed = holiday.closed_exchanges?.includes('NSE') ||
                          holiday.closed_exchanges?.includes('NFO');

        if (holiday.holiday_type === 'TRADING_HOLIDAY' && nseIsClosed) {
            return true;
        }

        if (holiday.holiday_type === 'TRADING_HOLIDAY') {
            const nseIsOpen = holiday.open_exchanges?.some(
                ex => ex.exchange === 'NSE' || ex.exchange === 'NFO'
            );
            return !nseIsOpen;
        }

        return false;
    } catch (error) {
        upstoxLogger.error('Error checking market holiday:', error);
        return false; // fail open
    }
}

// ============================================================================
// Legacy Exports (backward compatibility during migration)
// ============================================================================

/**
 * @deprecated Use getFullQuotes from '@/lib/upstox/client' instead.
 */
export async function getMarketQuote(instrumentKeys: string[]): Promise<unknown> {
    return Object.fromEntries(await getFullQuotes(instrumentKeys));
}
