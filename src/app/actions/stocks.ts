'use server';

import { prisma } from '@/lib/db';
import { validateSymbols } from '@/app/actions';

export interface StockSearchResult {
  symbol: string;
  sector: string;
  exchange: string;
}

export async function searchStocks(
  query: string,
  excludeSymbols: string[] = []
): Promise<StockSearchResult[]> {
  if (!query || query.length < 2) return [];

  const results = await prisma.sectorMapping.findMany({
    where: {
      symbol: { contains: query.toUpperCase() },
      NOT: { symbol: { in: excludeSymbols } },
    },
    select: { symbol: true, sector: true, exchange: true },
    take: 10,
    orderBy: { symbol: 'asc' },
  });

  return results;
}

export async function getStockPrice(symbol: string): Promise<number | null> {
  const results = await validateSymbols([symbol]);
  if (results[0]?.isValid && results[0]?.currentPrice) {
    return results[0].currentPrice;
  }
  return null;
}
