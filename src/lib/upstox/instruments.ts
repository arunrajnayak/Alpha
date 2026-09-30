/**
 * Upstox Instrument Service
 *
 * Re-exports from @/lib/instrument-service (single source of truth for instrument master).
 * Ensures a single shared in-memory instrument map, preventing duplicate 60MB+ file downloads,
 * dual caching, and concurrency race conditions on cold start.
 */

export {
  ensureInstrumentMaster,
  getInstrumentKey,
  getInstrumentKeys,
  getInstrumentKeyByISIN,
  getSymbolFromKey,
  getInstrumentData,
  getAllInstrumentData,
  getBESymbols,
  isValidSymbol,
  getAllSymbols,
  refreshInstrumentMaster,
  clearInstrumentCache,
  INDEX_INSTRUMENT_KEYS as INDEX_KEYS,
} from '@/lib/instrument-service';
