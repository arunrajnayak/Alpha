'use server';

import { prisma } from '@/lib/db';
import { validateSymbols } from '@/app/actions';
import { searchInstruments, getInstrumentKey } from '@/lib/instrument-service';
import { getAccessToken } from '@/lib/upstox/auth';
import { logger } from '@/lib/logger';

const stocksLogger = logger.scope('Stocks');

export interface StockSearchResult {
  symbol: string;
  name?: string;
  sector: string;
  exchange: string;
}

export async function searchStocks(
  query: string,
  excludeSymbols: string[] = []
): Promise<StockSearchResult[]> {
  if (!query || query.trim().length < 2) return [];

  const q = query.trim().toUpperCase();
  const excludeSet = new Set(excludeSymbols.map(s => s.toUpperCase()));

  try {
    // 1. Search instruments from Upstox master (all NSE/BSE equities)
    const instrumentMatches = await searchInstruments(q, 30);
    const matchedSymbols = instrumentMatches.map(m => m.symbol);

    // 2. Fetch sector mappings for matched instruments or matching query
    const sectorMappings = await prisma.sectorMapping.findMany({
      where: {
        OR: [
          ...(matchedSymbols.length > 0 ? [{ symbol: { in: matchedSymbols } }] : []),
          { symbol: { contains: q } },
        ],
        NOT: { symbol: { in: Array.from(excludeSet) } },
      },
      select: { symbol: true, sector: true, exchange: true },
      take: 50,
    });

    const sectorMap = new Map(sectorMappings.map(s => [s.symbol, s.sector]));

    const inferSector = (symbol: string, name?: string): string => {
      const fromMap = sectorMap.get(symbol);
      if (fromMap) return fromMap;
      const upperName = (name || '').toUpperCase();
      if (symbol.endsWith('ETF') || symbol.endsWith('IETF') || upperName.includes('ETF') || upperName.includes('INDEX')) {
        return 'ETF';
      }
      if (upperName.includes('GOLD') || upperName.includes('SILVER')) {
        return 'Commodities';
      }
      return 'Other';
    };

    const results: StockSearchResult[] = [];
    const seen = new Set<string>();

    // 3. Add instrument matches first (already ranked by relevance)
    for (const match of instrumentMatches) {
      if (excludeSet.has(match.symbol) || seen.has(match.symbol)) continue;
      seen.add(match.symbol);
      results.push({
        symbol: match.symbol,
        name: match.name,
        sector: inferSector(match.symbol, match.name),
        exchange: match.exchange,
      });
    }

    // 4. Add any SectorMapping matches not already included
    for (const s of sectorMappings) {
      if (excludeSet.has(s.symbol) || seen.has(s.symbol)) continue;
      seen.add(s.symbol);
      results.push({
        symbol: s.symbol,
        sector: s.sector,
        exchange: s.exchange,
      });
    }

    return results.slice(0, 20);
  } catch (error) {
    stocksLogger.error('Failed to search stocks:', error);

    // Fallback: direct database search on SectorMapping
    try {
      const fallbackResults = await prisma.sectorMapping.findMany({
        where: {
          symbol: { contains: q },
          NOT: { symbol: { in: Array.from(excludeSet) } },
        },
        select: { symbol: true, sector: true, exchange: true },
        take: 20,
        orderBy: { symbol: 'asc' },
      });
      return fallbackResults;
    } catch {
      return [];
    }
  }
}

export async function getStockPrice(symbol: string): Promise<number | null> {
  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const results = await validateSymbols([cleanSymbol]);
    if (results[0]?.isValid && results[0]?.currentPrice && results[0].currentPrice > 0) {
      return results[0].currentPrice;
    }
  } catch (err) {
    stocksLogger.warn(`validateSymbols failed for ${cleanSymbol}:`, err);
  }

  // Fallback 1: latest price from ScreenerPrice
  try {
    const screener = await prisma.screenerPrice.findFirst({
      where: { symbol: cleanSymbol },
      orderBy: { date: 'desc' },
      select: { close: true },
    });
    if (screener?.close && screener.close > 0) {
      return screener.close;
    }
  } catch { /* ignore */ }

  // Fallback 2: latest price from StockHistory
  try {
    const history = await prisma.stockHistory.findFirst({
      where: { symbol: cleanSymbol },
      orderBy: { date: 'desc' },
      select: { close: true },
    });
    if (history?.close && history.close > 0) {
      return history.close;
    }
  } catch { /* ignore */ }

  return null;
}

export interface DepthEntry {
  quantity: number;
  price: number;
  orders: number;
}

export interface StockMarketDepthData {
  symbol: string;
  instrumentKey: string;
  lastPrice: number;
  netChange: number;
  averagePrice: number;
  volume: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  lowerCircuitLimit: number;
  upperCircuitLimit: number;
  depth: {
    buy: DepthEntry[];
    sell: DepthEntry[];
  };
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  timestamp?: string;
}

/**
 * Fetch 5-level market depth, circuit limits, VWAP and volume for an NSE equity
 * from Upstox V3 Market Quote API.
 */
export async function getStockMarketDepthAction(
  symbol: string
): Promise<{ success: true; data: StockMarketDepthData } | { success: false; error: string }> {
  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const instrumentKey = await getInstrumentKey(cleanSymbol);
    if (!instrumentKey) {
      return { success: false, error: `Could not resolve instrument key for ${cleanSymbol}` };
    }

    const token = await getAccessToken();
    const url = `https://api.upstox.com/v3/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKey)}`;
    const resp = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Upstox API error (${resp.status}): ${errText}` };
    }

    const json = await resp.json();
    if (!json.data) {
      return { success: false, error: `No quote data available for ${cleanSymbol}` };
    }

    const firstKey = Object.keys(json.data)[0];
    const item = firstKey ? json.data[firstKey] : null;

    if (!item) {
      return { success: false, error: `Empty quote data returned for ${cleanSymbol}` };
    }

    const buyDepth: DepthEntry[] = (item.depth?.buy || []).map((b: { quantity?: number; price?: number; orders?: number }) => ({
      quantity: Number(b.quantity || 0),
      price: Number(b.price || 0),
      orders: Number(b.orders || 0),
    }));

    const sellDepth: DepthEntry[] = (item.depth?.sell || []).map((s: { quantity?: number; price?: number; orders?: number }) => ({
      quantity: Number(s.quantity || 0),
      price: Number(s.price || 0),
      orders: Number(s.orders || 0),
    }));

    return {
      success: true,
      data: {
        symbol: cleanSymbol,
        instrumentKey,
        lastPrice: Number(item.last_price || 0),
        netChange: Number(item.net_change || 0),
        averagePrice: Number(item.average_price || 0),
        volume: Number(item.volume || 0),
        totalBuyQuantity: Number(item.total_buy_quantity || 0),
        totalSellQuantity: Number(item.total_sell_quantity || 0),
        lowerCircuitLimit: Number(item.lower_circuit_limit || 0),
        upperCircuitLimit: Number(item.upper_circuit_limit || 0),
        depth: {
          buy: buyDepth,
          sell: sellDepth,
        },
        ohlc: {
          open: Number(item.ohlc?.open || 0),
          high: Number(item.ohlc?.high || 0),
          low: Number(item.ohlc?.low || 0),
          close: Number(item.ohlc?.close || 0),
        },
        timestamp: item.timestamp,
      },
    };
  } catch (err) {
    stocksLogger.error(`Failed to fetch market depth for ${cleanSymbol}:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch market depth',
    };
  }
}
