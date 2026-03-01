/**
 * Upstox Service Module
 * 
 * Re-exports all Upstox API functionality for easy imports.
 * 
 * Usage:
 *   import { getLiveQuotes, getInstrumentKey, getTokenStatus } from '@/lib/upstox';
 */

// Types
export * from './types';

// Authentication
export {
  getAccessToken,
  getStoredToken,
  hasValidToken,
  getTokenStatus,
  clearTokenCache,
  validateConfig,
  getWebSocketAuthUrl,
} from './auth';

// API Client
export {
  getHistoricalCandles,
  getLiveQuotes,
  getLTP,
  getFullQuotes,
  getOHLC,
  getIndexQuotes,
  INDEX_KEYS,
} from './client';

// Instruments
export {
  ensureInstrumentMaster,
  getInstrumentKey,
  getInstrumentKeys,
  getInstrumentKeyByISIN,
  getInstrumentData,
  getSymbolFromKey,
  isValidSymbol,
  clearInstrumentCache,
  refreshInstrumentMaster,
  getAllSymbols,
  INDEX_KEYS as INDEX_KEY_MAP,
} from './instruments';

// Market Info
export {
  getMarketHolidays,
  getTradingHolidays,
  isTradingHoliday,
  isTradingDay,
  getMarketTimings,
  isMarketOpen,
  getNextTradingDay,
  getPreviousTradingDay,
  clearHolidayCache,
} from './market-info';
