'use server';

import { prisma } from '@/lib/db';
import { validateSymbols } from '@/app/actions';
import { searchInstruments } from '@/lib/instrument-service';
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
