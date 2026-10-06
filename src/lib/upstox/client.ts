/**
 * Upstox API Client
 * 
 * Handles all REST API interactions with Upstox.
 * Uses token management from auth.ts.
 */

import { getAccessToken, clearTokenCache } from './auth';
import { logger } from '@/lib/logger';
import {
  UpstoxLiveQuote,
  UpstoxFullQuote,
  UpstoxCandle,
  OHLC,
  HistoricalInterval,
  OHLCInterval,
  UpstoxError,
  LTPResponseValue,
  OHLCResponseValue,
  UpstoxCorporateActionEvent,
  UpstoxCorporateActionsResponse,
} from './types';

const upstoxLogger = logger.scope('Upstox');

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL_V3 = 'https://api.upstox.com/v3';
const BATCH_SIZE = 200; // Safe batch size (keeps URI ~4.6KB, avoiding HTTP 414 on reverse proxies/CDNs)

// ============================================================================
// Utility Functions
// ============================================================================

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * Build a lookup map for instrument key normalization
 * Upstox responses use colon format (NSE_EQ:RELIANCE) but we request with pipe format
 */
function buildKeyLookup(instrumentKeys: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const key of instrumentKeys) {
    const colonKey = key.replace(/\|/g, ':');
    lookup.set(colonKey, key);
    lookup.set(key, key);
  }
  return lookup;
}

// ============================================================================
// Historical Data
// ============================================================================

/**
 * Fetch Historical Candle Data using V3 API
 * 
 * @param instrumentKey - Upstox instrument key (e.g., NSE_EQ|INE002A01018)
 * @param interval - Time interval
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 */
export async function getHistoricalCandles(
  instrumentKey: string,
  interval: HistoricalInterval,
  fromDate: string,
  toDate: string
): Promise<{ candles: UpstoxCandle[] }> {
  const accessToken = await getAccessToken();
  const encodedKey = encodeURIComponent(instrumentKey);

  // V3 API uses plural unit names and numeric interval
  let unit: string;
  let intervalValue: string;

  switch (interval) {
    case '1minute':
      unit = 'minutes';
      intervalValue = '1';
      break;
    case '5minute':
      unit = 'minutes';
      intervalValue = '5';
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

  const url = `${BASE_URL_V3}/historical-candle/${encodedKey}/${unit}/${intervalValue}/${toDate}/${fromDate}`;

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    upstoxLogger.error(`Historical fetch failed for ${instrumentKey}:`, errorText);
    throw new UpstoxError(
      `Historical fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();

  // Transform candle array format to object format
  const candles: UpstoxCandle[] = (json.data?.candles || []).map(
    (c: (string | number)[]) => ({
      timestamp: c[0] as string,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
      oi: c[6] as number,
    })
  );

  return { candles };
}

/**
 * Fetch Intraday Candle Data for current trading day (V3 API)
 * V3 URL format: /v3/historical-candle/intraday/{instrumentKey}/minutes/{interval}
 */
export async function getIntradayCandles(
  instrumentKey: string,
  interval: '1minute' | '5minute' | '30minute' = '5minute'
): Promise<{ candles: UpstoxCandle[] }> {
  const encodedKey = encodeURIComponent(instrumentKey);
  const intervalValue = interval === '1minute' ? '1' : interval === '30minute' ? '30' : '5';
  const url = `${BASE_URL_V3}/historical-candle/intraday/${encodedKey}/minutes/${intervalValue}`;

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      upstoxLogger.warn(`Intraday candles fetch failed for ${instrumentKey}: ${response.status}`);
      return { candles: [] };
    }

    const json = await response.json();
    const candles: UpstoxCandle[] = (json.data?.candles || []).map((c: (string | number)[]) => ({
      timestamp: c[0] as string,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
      oi: c[6] as number,
    }));

    return { candles };
  } catch {
    return { candles: [] };
  }
}

// ============================================================================
// Live Market Data
// ============================================================================

/**
 * Get Live Quotes (LTP + Previous Close) for multiple instruments
 * Uses LTP V3 endpoint - lightweight and provides previous close
 * Handles batching (Max 500 instruments per call)
 */
export async function getLiveQuotes(
  instrumentKeys: string[],
  retryOnAuth = true
): Promise<Map<string, UpstoxLiveQuote>> {
  const accessToken = await getAccessToken();
  const result = new Map<string, UpstoxLiveQuote>();
  const requestKeyLookup = buildKeyLookup(instrumentKeys);

  const batches = chunkArray(instrumentKeys, BATCH_SIZE);
  let shouldRetry401 = false;

  await Promise.all(
    batches.map(async (batch) => {
      const url = `${BASE_URL_V3}/market-quote/ltp?instrument_key=${batch
        .map((k) => encodeURIComponent(k))
        .join(',')}`;

      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 && retryOnAuth) {
            shouldRetry401 = true;
            return;
          }

          const errorText = await response.text();
          throw new UpstoxError(
            `LTP fetch failed: ${response.status} - ${errorText}`,
            response.status
          );
        }

        const json = await response.json();

        if (json.data) {
          for (const [responseKey, val] of Object.entries(json.data)) {
            const value = val as LTPResponseValue;

            // Map response key back to request key
            let mappedKey = value.instrument_token;
            if (!mappedKey) mappedKey = requestKeyLookup.get(responseKey);
            if (!mappedKey) mappedKey = responseKey.replace(/:/g, '|');

            result.set(mappedKey, {
              last_price: value.last_price,
              instrument_token: value.instrument_token || mappedKey,
              previous_close: value.cp ?? 0,
              volume: value.volume,
              ltq: value.ltq,
              timestamp: value.ltt ? parseInt(value.ltt, 10) : undefined,
            });
          }
        }
      } catch (error) {
        if (error instanceof UpstoxError) throw error;
        upstoxLogger.error('Batch LTP fetch failed:', error);
      }
    })
  );

  if (shouldRetry401 && retryOnAuth) {
    upstoxLogger.info('Got 401, clearing cache and retrying with fresh token...');
    clearTokenCache();
    return getLiveQuotes(instrumentKeys, false);
  }

  return result;
}

/**
 * Get Last Traded Price for multiple instruments
 * Lightweight wrapper around getLiveQuotes
 */
export async function getLTP(instrumentKeys: string[]): Promise<Map<string, number>> {
  const quotes = await getLiveQuotes(instrumentKeys);
  const result = new Map<string, number>();

  for (const [key, quote] of quotes.entries()) {
    result.set(key, quote.last_price);
  }

  return result;
}

/**
 * Get Full Market Quote for multiple instruments
 * Uses V3 endpoint for comprehensive data (OHLC, volume, circuit limits, CAS & Pre-Open IEP)
 */
export async function getFullQuotes(
  instrumentKeys: string[],
  retryOnAuth = true
): Promise<Map<string, UpstoxFullQuote>> {
  if (instrumentKeys.length === 0) return new Map();

  const accessToken = await getAccessToken();
  const requestKeyLookup = buildKeyLookup(instrumentKeys);
  const result = new Map<string, UpstoxFullQuote>();

  const batches = chunkArray(instrumentKeys, BATCH_SIZE);
  let shouldRetry401 = false;

  await Promise.all(
    batches.map(async (batch) => {
      const url = `${BASE_URL_V3}/market-quote/quotes?instrument_key=${batch
        .map((k) => encodeURIComponent(k))
        .join(',')}`;

      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 && retryOnAuth) {
            shouldRetry401 = true;
            return;
          }

          const errorText = await response.text();
          upstoxLogger.error(`Batch full quote fetch failed: ${response.status} - ${errorText}`);
          return;
        }

        const json = await response.json();

        if (json.data) {
          for (const [responseKey, value] of Object.entries(json.data)) {
            const val = value as UpstoxFullQuote;
            const normalizedKey = responseKey.replace(/:/g, '|');
            const mappedKey =
              (val.instrument_token && requestKeyLookup.get(val.instrument_token)) ||
              requestKeyLookup.get(responseKey) ||
              requestKeyLookup.get(normalizedKey) ||
              val.instrument_token ||
              normalizedKey;

            result.set(mappedKey, val);
          }
        }
      } catch (error) {
        upstoxLogger.error('Batch full quote fetch error:', error);
      }
    })
  );

  if (shouldRetry401 && retryOnAuth) {
    upstoxLogger.info('Got 401 in getFullQuotes, clearing cache and retrying with fresh token...');
    clearTokenCache();
    return getFullQuotes(instrumentKeys, false);
  }

  return result;
}

/**
 * Get OHLC data for multiple instruments using V3 API
 *
 * @param instrumentKeys - Array of instrument keys (pipe-format)
 * @param interval - OHLC interval: '1d' (daily), 'I1' (1-minute), 'I30' (30-minute)
 * @param preferPrevOhlc - When true (market hours), prefer prev_ohlc (last settled candle)
 *   over the incomplete live intraday candle. When false (default, after close), use ONLY
 *   live_ohlc so a missing live_ohlc omits the instrument from the result rather than
 *   silently returning T-1's price under today's date.
 * @param retryOnAuth - Auto-refresh token and retry on 401
 */
export async function getOHLC(
  instrumentKeys: string[],
  interval: OHLCInterval = '1d',
  preferPrevOhlc = false,
  retryOnAuth = true,
): Promise<Map<string, OHLC>> {
  if (instrumentKeys.length === 0) return new Map();

  const accessToken = await getAccessToken();
  const requestKeyLookup = buildKeyLookup(instrumentKeys);
  const result = new Map<string, OHLC>();

  const batches = chunkArray(instrumentKeys, BATCH_SIZE);
  let shouldRetry401 = false;

  await Promise.all(
    batches.map(async (batch) => {
      const url = `${BASE_URL_V3}/market-quote/ohlc?instrument_key=${batch
        .map((k) => encodeURIComponent(k))
        .join(',')}&interval=${interval}`;

      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 && retryOnAuth) {
            shouldRetry401 = true;
            return;
          }

          const errorText = await response.text();
          upstoxLogger.error(`Batch OHLC fetch failed: ${response.status} - ${errorText}`);
          return;
        }

        const json = await response.json();

        if (json.data) {
          for (const [responseKey, value] of Object.entries(json.data)) {
            const data = value as OHLCResponseValue;
            // Market hours (preferPrevOhlc=true): use the last settled close (prev_ohlc)
            // rather than the incomplete live candle.
            // After close (preferPrevOhlc=false): use ONLY live_ohlc. Omitting instruments
            // with no live_ohlc lets callers detect them as missing and retry via
            // getHistoricalCandles, which has the official settled EOD candle.
            const ohlc = preferPrevOhlc
              ? (data.prev_ohlc || data.live_ohlc)
              : data.live_ohlc;
            if (ohlc) {
              const ohlcObj: OHLC = {
                open: ohlc.open,
                high: ohlc.high,
                low: ohlc.low,
                close: ohlc.close,
                volume: ohlc.volume,
                ts: ohlc.ts,
                last_price: data.last_price,
                prev_close: data.prev_ohlc?.close,
              };

              const normalizedKey = responseKey.replace(/:/g, '|');
              if (data.instrument_token) {
                result.set(data.instrument_token, ohlcObj);
              }
              const lookupByResponse = requestKeyLookup.get(responseKey);
              if (lookupByResponse) {
                result.set(lookupByResponse, ohlcObj);
              }
              const lookupByNormalized = requestKeyLookup.get(normalizedKey);
              if (lookupByNormalized) {
                result.set(lookupByNormalized, ohlcObj);
              }
              result.set(normalizedKey, ohlcObj);
              result.set(responseKey, ohlcObj);
            }
          }
        }
      } catch (error) {
        upstoxLogger.error('Batch OHLC fetch error:', error);
      }
    })
  );

  if (shouldRetry401 && retryOnAuth) {
    upstoxLogger.info('Got 401 in getOHLC, clearing cache and retrying with fresh token...');
    clearTokenCache();
    return getOHLC(instrumentKeys, interval, preferPrevOhlc, false);
  }

  return result;
}


// ============================================================================
// Index Quotes
// ============================================================================

/**
 * Index instrument keys for common indices
 * Verified from: https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
 */
export const INDEX_KEYS = {
  'Nifty 50': 'NSE_INDEX|Nifty 50',
  'Nifty Midcap 100': 'NSE_INDEX|NIFTY MIDCAP 100',
  'Nifty Smallcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',
  'Nifty Microcap 250': 'NSE_INDEX|NIFTY MICROCAP250',
  'Nifty 500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50',
  'Nifty Next 50': 'NSE_INDEX|Nifty Next 50',
} as const;

export type IndexName = keyof typeof INDEX_KEYS;

/**
 * Get quotes for major market indices
 */
export async function getIndexQuotes(): Promise<
  Array<{ name: string; symbol: string; currentPrice: number; percentChange: number }>
> {
  const indexNames = Object.keys(INDEX_KEYS) as IndexName[];
  const indexKeys = indexNames.map((name) => INDEX_KEYS[name]);

  try {
    const quotes = await getLiveQuotes(indexKeys);
    const results: Array<{
      name: string;
      symbol: string;
      currentPrice: number;
      percentChange: number;
    }> = [];

    const usedQuotes = new Set<string>();

    for (let i = 0; i < indexNames.length; i++) {
      const name = indexNames[i];
      const key = indexKeys[i];

      let quote = quotes.get(key);
      let matchedKey: string = key;

      if (!quote) {
        const colonKey = key.replace(/\|/g, ':');
        quote = quotes.get(colonKey);
        if (quote) matchedKey = colonKey;
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
      }
    }

    return results;
  } catch (error) {
    upstoxLogger.error('Failed to fetch index quotes:', error);
    return [];
  }
}

// ============================================================================
// Corporate Actions (Fundamentals API)
// ============================================================================

/**
 * Fetch corporate actions by ISIN using Upstox Fundamentals API.
 * Returns array of events (Split, Bonus, Dividend, Rights, etc.)
 * Endpoint: GET /v2/fundamentals/{isin}/corporate-actions
 */
export async function getCorporateActionsByISIN(
  isin: string
): Promise<UpstoxCorporateActionEvent[]> {
  const token = await getAccessToken();
  const url = `https://api.upstox.com/v2/fundamentals/${isin}/corporate-actions`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 404) return [];
      const txt = await res.text();
      upstoxLogger.warn(`Corporate actions fetch failed for ISIN ${isin} (${res.status}): ${txt.slice(0, 100)}`);
      return [];
    }

    const json: UpstoxCorporateActionsResponse = await res.json();
    return json.data || [];
  } catch (error) {
    upstoxLogger.error(`Error fetching corporate actions for ISIN ${isin}:`, error);
    return [];
  }
}

