'use server';

/**
 * Market Overview Server Action
 * 
 * Fetches live market data for index constituents,
 * computes advance/decline, and returns structured data.
 */

import { getIndexConstituentData, INDEX_CONFIG } from '@/lib/index-constituents';
import { getInstrumentKeys } from '@/lib/instrument-service';
import { getFullQuotes, getLiveQuotes } from '@/lib/upstox/client';
import { hasValidToken } from '@/lib/upstox-client';
import { logger } from '@/lib/logger';
import { isMarketOpen, isPreOpenSession } from '@/lib/market-status-utils';
import { isTradingHoliday } from '@/lib/market-holidays-cache';
import { istDayOfWeek } from '@/lib/tz';

const marketLogger = logger.scope('Market');

// ============================================================================
// Types
// ============================================================================

export interface ConstituentQuote {
  symbol: string;
  name: string;
  instrumentKey: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  weight: number;
}

export interface MarketOverviewData {
  indexName: string;
  indexValue: number;
  indexChange: number;
  indexChangePercent: number;
  constituents: ConstituentQuote[];
  advancing: number;
  declining: number;
  unchanged: number;
  topGainers: ConstituentQuote[];
  topLosers: ConstituentQuote[];
  lastUpdated: string;
  marketStatus?: 'OPEN' | 'CLOSED' | 'PRE_OPEN';
  tokenStatus?: {
    hasToken: boolean;
    message?: string;
  };
}

// ============================================================================
// Server Action
// ============================================================================

/**
 * Fetch market overview data for a given index
 */
export async function fetchMarketOverview(indexName: string): Promise<MarketOverviewData | null> {
  try {
    const config = INDEX_CONFIG[indexName];
    if (!config) {
      marketLogger.error(`Unknown index: ${indexName}`);
      return null;
    }

    // Check token availability
    const hasToken = await hasValidToken();
    const tokenStatus = {
      hasToken,
      message: hasToken ? undefined : 'No valid Upstox token. Please approve the token request on your phone.'
    };
    
    if (!hasToken) {
      marketLogger.warn('No valid Upstox token');
      return {
        indexName,
        indexValue: 0,
        indexChange: 0,
        indexChangePercent: 0,
        constituents: [],
        advancing: 0,
        declining: 0,
        unchanged: 0,
        topGainers: [],
        topLosers: [],
        lastUpdated: new Date().toISOString(),
        tokenStatus
      };
    }

    // Check market status
    const isHoliday = await isTradingHoliday(new Date());
    const day = istDayOfWeek(new Date());
    const isTradingDayToday = day >= 1 && day <= 5 && !isHoliday;
    const isPreOpen = isTradingDayToday && isPreOpenSession();
    const isRegularOpen = isTradingDayToday && isMarketOpen();

    let marketStatus: 'OPEN' | 'CLOSED' | 'PRE_OPEN' = 'CLOSED';
    if (isRegularOpen) {
      marketStatus = 'OPEN';
    } else if (isPreOpen) {
      marketStatus = 'PRE_OPEN';
    }

    // 1. Get constituent symbols and weights
    const { symbols, weights } = await getIndexConstituentData(indexName);
    if (symbols.length === 0) {
      marketLogger.warn(`No constituents found for ${indexName}`);
      return null;
    }

    marketLogger.info(`Fetching data for ${symbols.length} constituents of ${indexName}`);

    // 2. Map symbols to Upstox instrument keys
    const symbolToKey = await getInstrumentKeys(symbols);
    const instrumentKeys = Array.from(symbolToKey.values());
    
    if (instrumentKeys.length === 0) {
      marketLogger.error(`No instrument keys found for ${indexName}`);
      return null;
    }

    // 3. Fetch full quotes in batches (Upstox URL length limit) + index quote in parallel
    // Use larger batches for large indices (e.g. Microcap 250) to reduce round-trips.
    // Upstox Full Quote URL can handle ~50 keys before hitting URL length limits.
    const BATCH_SIZE = 50;
    const batches: string[][] = [];
    for (let i = 0; i < instrumentKeys.length; i += BATCH_SIZE) {
      batches.push(instrumentKeys.slice(i, i + BATCH_SIZE));
    }

    // Use allSettled so partial batch failures don't kill the entire request
    // (critical for large indices like Microcap 250 with 10+ batches)
    const [batchSettled, indexQuoteMap] = await Promise.all([
      Promise.allSettled(batches.map(batch => getFullQuotes(batch))),
      getLiveQuotes([config.upstoxKey]),
    ]);

    // Merge successful batch results, log failures
    const fullQuotesMap = new Map<string, any>();
    let failedBatches = 0;
    for (let i = 0; i < batchSettled.length; i++) {
      const result = batchSettled[i];
      if (result.status === 'fulfilled') {
        for (const [key, value] of result.value.entries()) {
          fullQuotesMap.set(key, value);
        }
      } else {
        failedBatches++;
        marketLogger.error(`Batch ${i + 1}/${batches.length} failed for ${indexName}:`, result.reason);
      }
    }

    if (failedBatches > 0) {
      marketLogger.warn(`${failedBatches}/${batches.length} batches failed for ${indexName}. Got ${fullQuotesMap.size}/${instrumentKeys.length} quotes.`);
    }

    if (fullQuotesMap.size === 0) {
      marketLogger.error(`All batches failed for ${indexName}`);
      return null;
    }

    // 4. Build reverse lookup: key -> symbol
    const keyToSymbol = new Map<string, string>();
    for (const [sym, key] of symbolToKey.entries()) {
      keyToSymbol.set(key, sym);
      // Also add colon format
      keyToSymbol.set(key.replace(/\|/g, ':'), sym);
    }

    // 5. Build constituent list from unique symbols
    const constituents: ConstituentQuote[] = [];
    const seenSymbols = new Set<string>();
    
    // Equal weight fallback: if no weights from CSV, use 1/N
    const hasWeights = Object.keys(weights).length > 0;
    const equalWeight = 100 / symbols.length;
    
    for (const rawSymbol of symbols) {
      const sym = rawSymbol.toUpperCase();
      if (seenSymbols.has(sym)) continue;
      seenSymbols.add(sym);

      const key = symbolToKey.get(rawSymbol) || symbolToKey.get(sym);
      if (!key) continue;

      const quote = fullQuotesMap.get(key) || 
                    fullQuotesMap.get(key.replace(/\|/g, ':')) || 
                    fullQuotesMap.get(key.replace(/:/g, '|'));
      if (!quote) continue;

      // In Upstox V3 Full Quote:
      // prev_close_price is the true previous day close (ohlc.close is the current session close/LTP!)
      const prevClose = quote.prev_close_price || 
        (quote.last_price > 0 && quote.net_change !== undefined ? quote.last_price - quote.net_change : 0) || 
        quote.ohlc?.close || 0;

      // Handle Pre-Open IEP
      const iep = quote.indicative_equilibrium_price && quote.indicative_equilibrium_price > 0
        ? quote.indicative_equilibrium_price
        : undefined;

      const activePrice = (isPreOpen && iep) ? iep : (quote.last_price || iep || prevClose);
      const change = (isPreOpen && iep && prevClose > 0)
        ? (iep - prevClose)
        : (quote.net_change !== undefined && quote.net_change !== null ? quote.net_change : (activePrice - prevClose));
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

      constituents.push({
        symbol: sym,
        name: quote.symbol || sym,
        instrumentKey: key,
        lastPrice: activePrice,
        change,
        changePercent,
        open: quote.ohlc?.open || 0,
        high: quote.ohlc?.high || 0,
        low: quote.ohlc?.low || 0,
        prevClose,
        volume: quote.volume || 0,
        weight: hasWeights ? (weights[sym] || equalWeight) : equalWeight,
      });
    }

    // 6. Compute advance/decline
    let advancing = 0;
    let declining = 0;
    let unchanged = 0;

    for (const c of constituents) {
      if (c.changePercent > 0.01) advancing++;
      else if (c.changePercent < -0.01) declining++;
      else unchanged++;
    }

    // 7. Top gainers/losers
    const sorted = [...constituents].sort((a, b) => b.changePercent - a.changePercent);
    const topGainers = sorted.filter(c => c.changePercent > 0).slice(0, 10);
    // sorted is DESC — losers sit at the tail. Slice the last 10, then reverse so biggest loser is first.
    const losers = sorted.filter(c => c.changePercent < 0);
    const topLosers = losers.slice(-Math.min(10, losers.length)).reverse();

    // 8. Index value
    let indexValue = 0;
    let indexChange = 0;
    let indexChangePercent = 0;

    const indexQuote = indexQuoteMap.get(config.upstoxKey) || 
      indexQuoteMap.get(config.upstoxKey.replace(/\|/g, ':')) ||
      indexQuoteMap.get(config.upstoxKey.replace(/:/g, '|'));
    
    if (indexQuote) {
      indexValue = indexQuote.last_price;
      const prevClose = indexQuote.previous_close || indexValue;
      indexChange = indexValue - prevClose;
      indexChangePercent = prevClose > 0 ? (indexChange / prevClose) * 100 : 0;
    }

    return {
      indexName,
      indexValue,
      indexChange,
      indexChangePercent,
      constituents: sorted,
      advancing,
      declining,
      unchanged,
      topGainers,
      topLosers,
      lastUpdated: new Date().toISOString(),
      marketStatus,
      tokenStatus,
    };

  } catch (error) {
    marketLogger.error(`Error fetching data for ${indexName}:`, error);
    return null;
  }
}

/**
 * Fetch summary data for all indices (lightweight — just index quotes)
 */
export async function fetchAllIndexSummaries(): Promise<{
  summaries: Array<{
    name: string;
    shortName: string;
    category: string;
    value: number;
    change: number;
    changePercent: number;
    instrumentKey: string;
  }>;
  marketStatus?: 'OPEN' | 'CLOSED' | 'PRE_OPEN';
  tokenStatus?: { hasToken: boolean; message?: string };
}> {
  try {
    const isHoliday = await isTradingHoliday(new Date());
    const day = istDayOfWeek(new Date());
    const isTradingDayToday = day >= 1 && day <= 5 && !isHoliday;
    const isPreOpen = isTradingDayToday && isPreOpenSession();
    const isRegularOpen = isTradingDayToday && isMarketOpen();

    let marketStatus: 'OPEN' | 'CLOSED' | 'PRE_OPEN' = 'CLOSED';
    if (isRegularOpen) {
      marketStatus = 'OPEN';
    } else if (isPreOpen) {
      marketStatus = 'PRE_OPEN';
    }

    const hasToken = await hasValidToken();
    if (!hasToken) {
      return { summaries: [], marketStatus, tokenStatus: { hasToken: false, message: 'No valid Upstox token.' } };
    }

    const indexKeys = Object.entries(INDEX_CONFIG).map(([name, config]) => ({
      name,
      shortName: config.shortName,
      category: config.category,
      key: config.upstoxKey,
    }));

    const quotes = await getLiveQuotes(indexKeys.map(i => i.key));

    const summaries: Array<{
      name: string;
      shortName: string;
      category: string;
      value: number;
      change: number;
      changePercent: number;
      instrumentKey: string;
    }> = [];

    for (const idx of indexKeys) {
      const quote = quotes.get(idx.key) || quotes.get(idx.key.replace(/\|/g, ':'));
      if (quote) {
        const prevClose = quote.previous_close || quote.last_price;
        const change = quote.last_price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

        summaries.push({
          name: idx.name,
          shortName: idx.shortName,
          category: idx.category,
          value: quote.last_price,
          change,
          changePercent,
          instrumentKey: idx.key,
        });
      }
    }

    return { summaries, marketStatus, tokenStatus: { hasToken: true } };
  } catch (error) {
    marketLogger.error('Error fetching index summaries:', error);
    return { summaries: [] };
  }
}
