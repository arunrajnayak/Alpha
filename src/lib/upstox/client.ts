/**
 * Upstox API Client
 * 
 * Handles all REST API interactions with Upstox.
 * Uses token management from auth.ts.
 */

import { getAccessToken, clearTokenCache } from './auth';
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
} from './types';

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL_V2 = 'https://api.upstox.com/v2';
const BASE_URL_V3 = 'https://api.upstox.com/v3';
const BATCH_SIZE = 500; // Upstox limit for LTP requests

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
): Promise<UpstoxCandle[]> {
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
    console.error(`[Upstox] Historical fetch failed for ${instrumentKey}:`, errorText);
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

  return candles;
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

  for (const batch of batches) {
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
        const errorText = await response.text();

        // Retry on 401 with fresh token
        if (response.status === 401 && retryOnAuth) {
          console.log('[Upstox] Got 401, clearing cache and retrying...');
          clearTokenCache();
          return getLiveQuotes(instrumentKeys, false);
        }

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
            timestamp: value.ltt ? parseInt(value.ltt, 10) : undefined,
          });
        }
      }
    } catch (error) {
      if (error instanceof UpstoxError) throw error;
      console.error(`[Upstox] Batch fetch failed:`, error);
      throw error;
    }
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
 * Uses V2 endpoint for comprehensive data (OHLC, volume, circuit limits)
 */
export async function getFullQuotes(
  instrumentKeys: string[]
): Promise<Map<string, UpstoxFullQuote>> {
  const accessToken = await getAccessToken();
  const requestKeyLookup = buildKeyLookup(instrumentKeys);

  const url = `${BASE_URL_V2}/market-quote/quotes?instrument_key=${instrumentKeys
    .map((k) => encodeURIComponent(k))
    .join(',')}`;

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
    throw new UpstoxError(
      `Full quote fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();
  const result = new Map<string, UpstoxFullQuote>();

  if (json.data) {
    for (const [responseKey, value] of Object.entries(json.data)) {
      const normalizedKey = responseKey.replace(/:/g, '|');
      const originalKey =
        requestKeyLookup.get(responseKey) ||
        requestKeyLookup.get(normalizedKey) ||
        normalizedKey;

      result.set(originalKey, value as UpstoxFullQuote);
    }
  }

  return result;
}

/**
 * Get OHLC data for multiple instruments using V3 API
 */
export async function getOHLC(
  instrumentKeys: string[],
  interval: OHLCInterval = '1d'
): Promise<Map<string, OHLC>> {
  const accessToken = await getAccessToken();
  const requestKeyLookup = buildKeyLookup(instrumentKeys);

  const url = `${BASE_URL_V3}/market-quote/ohlc?instrument_key=${instrumentKeys
    .map((k) => encodeURIComponent(k))
    .join(',')}&interval=${interval}`;

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
    throw new UpstoxError(
      `OHLC fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();
  const result = new Map<string, OHLC>();

  if (json.data) {
    for (const [responseKey, value] of Object.entries(json.data)) {
      const data = value as OHLCResponseValue;
      const ohlc = data.live_ohlc || data.prev_ohlc;

      if (ohlc) {
        const normalizedKey = responseKey.replace(/:/g, '|');
        const originalKey =
          requestKeyLookup.get(responseKey) ||
          requestKeyLookup.get(normalizedKey) ||
          normalizedKey;

        result.set(originalKey, {
          open: ohlc.open,
          high: ohlc.high,
          low: ohlc.low,
          close: ohlc.close,
          volume: ohlc.volume,
        });
      }
    }
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
  'Nifty Bank': 'NSE_INDEX|Nifty Bank',
  'Nifty IT': 'NSE_INDEX|Nifty IT',
  'Nifty Next 50': 'NSE_INDEX|Nifty Next 50',
} as const;

export type IndexName = keyof typeof INDEX_KEYS;

/**
 * Get quotes for major market indices
 */
export async function getIndexQuotes(): Promise<
  Array<{ name: string; symbol: string; currentPrice: number; percentChange: number }>
> {
  const indexNames = Object.keys(INDEX_KEYS).slice(0, 5) as IndexName[];
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
    console.error('[Upstox] Failed to fetch index quotes:', error);
    return [];
  }
}
