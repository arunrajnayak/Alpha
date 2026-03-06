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

// ============================================================================
// Types
// ============================================================================

export interface ConstituentQuote {
  symbol: string;
  name: string;
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
      console.error(`[MarketOverview] Unknown index: ${indexName}`);
      return null;
    }

    // Check token availability
    const hasToken = await hasValidToken();
    if (!hasToken) {
      console.warn('[MarketOverview] No valid Upstox token');
      return null;
    }

    // 1. Get constituent symbols and weights
    const { symbols, weights } = await getIndexConstituentData(indexName);
    if (symbols.length === 0) {
      console.warn(`[MarketOverview] No constituents found for ${indexName}`);
      return null;
    }

    console.log(`[MarketOverview] Fetching data for ${symbols.length} constituents of ${indexName}`);

    // 2. Map symbols to Upstox instrument keys
    const symbolToKey = await getInstrumentKeys(symbols);
    const instrumentKeys = Array.from(symbolToKey.values());
    
    if (instrumentKeys.length === 0) {
      console.error(`[MarketOverview] No instrument keys found for ${indexName}`);
      return null;
    }

    // 3. Fetch full quotes for constituents + index quote in parallel
    const [fullQuotesMap, indexQuoteMap] = await Promise.all([
      getFullQuotes(instrumentKeys),
      getLiveQuotes([config.upstoxKey]),
    ]);

    // 4. Build reverse lookup: key -> symbol
    const keyToSymbol = new Map<string, string>();
    for (const [sym, key] of symbolToKey.entries()) {
      keyToSymbol.set(key, sym);
      // Also add colon format
      keyToSymbol.set(key.replace(/\|/g, ':'), sym);
    }

    // 5. Build constituent list using net_change from Full Quote API
    const constituents: ConstituentQuote[] = [];
    
    // Equal weight fallback: if no weights from CSV, use 1/N
    const hasWeights = Object.keys(weights).length > 0;
    const equalWeight = 100 / symbols.length;
    
    for (const [key, quote] of fullQuotesMap.entries()) {
      const symbol = keyToSymbol.get(key) || quote.symbol || key.split('|')[1] || key;
      const sym = symbol.toUpperCase();
      const prevClose = quote.ohlc?.close || 0;
      
      // Use net_change directly from API — it's the authoritative change value
      const change = quote.net_change || 0;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

      constituents.push({
        symbol: sym,
        name: quote.symbol || symbol,
        lastPrice: quote.last_price,
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
    const topLosers = sorted.filter(c => c.changePercent < 0).reverse().slice(0, 10);

    // 8. Index value
    let indexValue = 0;
    let indexChange = 0;
    let indexChangePercent = 0;

    const indexQuote = indexQuoteMap.get(config.upstoxKey) || 
      indexQuoteMap.get(config.upstoxKey.replace(/\|/g, ':'));
    
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
    };

  } catch (error) {
    console.error(`[MarketOverview] Error fetching data for ${indexName}:`, error);
    return null;
  }
}

/**
 * Fetch summary data for all indices (lightweight — just index quotes)
 */
export async function fetchAllIndexSummaries(): Promise<Array<{
  name: string;
  shortName: string;
  category: string;
  value: number;
  change: number;
  changePercent: number;
}>> {
  try {
    const hasToken = await hasValidToken();
    if (!hasToken) return [];

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
        });
      }
    }

    return summaries;
  } catch (error) {
    console.error('[MarketOverview] Error fetching index summaries:', error);
    return [];
  }
}
