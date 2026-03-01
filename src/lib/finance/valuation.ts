/**
 * Unified Portfolio Valuation Service
 * 
 * This module provides a SINGLE source of truth for calculating portfolio value.
 * Both daily snapshots and the holdings modal use this function to ensure
 * totalEquity and TOTAL VALUE are always identical.
 */

import { prisma, chunkArray } from '@/lib/db';
import { PortfolioEngine } from '@/lib/portfolio-engine';
import { getLiveQuotes, getInstrumentKeys } from '@/lib/upstox';
import { getCategoriesBatch } from '@/lib/amfi';

// ============================================================================
// Types
// ============================================================================

export interface HoldingValuation {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  invested: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  marketCapCategory?: string;
  sector?: string;
}

export interface PortfolioValuation {
  totalValue: number;
  totalInvested: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPercent: number;
  holdings: HoldingValuation[];
  marketCapBreakdown: {
    large: { value: number; percentage: number };
    mid: { value: number; percentage: number };
    small: { value: number; percentage: number };
    micro: { value: number; percentage: number };
  };
  lastUpdated: Date;
}

// ============================================================================
// Core Valuation Function
// ============================================================================

/**
 * Calculate unified portfolio value
 * This is THE ONLY function that should be used to calculate portfolio total value.
 * 
 * @param options.useLivePrices - If true, fetch live prices from Upstox. If false, use latest from DB.
 * @param options.referenceDate - For historical calculations, specify a date.
 */
export async function calculatePortfolioValue(
  options: {
    useLivePrices?: boolean;
    referenceDate?: Date;
  } = {}
): Promise<PortfolioValuation> {
  const { useLivePrices = true, referenceDate } = options;

  // 1. Get all transactions up to reference date
  const transactions = await prisma.transaction.findMany({
    where: referenceDate ? { date: { lte: referenceDate } } : undefined,
    orderBy: { date: 'asc' },
  });

  if (transactions.length === 0) {
    return createEmptyValuation();
  }

  // 2. Process transactions through portfolio engine
  const engine = new PortfolioEngine();

  // Get symbol mappings for normalization
  const symbolMappings = await prisma.symbolMapping.findMany();
  const mappingLookup = new Map<string, string>();
  for (const m of symbolMappings) {
    mappingLookup.set(m.oldSymbol.toUpperCase(), m.newSymbol.toUpperCase());
  }

  const resolveSymbol = (symbol: string): string => {
    let current = symbol.toUpperCase().trim();
    const visited = new Set<string>();
    while (mappingLookup.has(current) && !visited.has(current)) {
      visited.add(current);
      current = mappingLookup.get(current)!;
    }
    return current;
  };

  for (const tx of transactions) {
    engine.processTransaction({
      ...tx,
      symbol: resolveSymbol(tx.symbol),
    });
  }

  // 3. Get active holdings (qty > 0)
  const activeHoldings: Array<{ symbol: string; qty: number; invested: number }> = [];
  for (const [symbol, holding] of engine.holdings) {
    if (holding.qty > 0.01) {
      activeHoldings.push({
        symbol,
        qty: holding.qty,
        invested: holding.invested,
      });
    }
  }

  if (activeHoldings.length === 0) {
    return createEmptyValuation();
  }

  const symbols = activeHoldings.map((h) => h.symbol);

  // 4. Get prices (live or from DB)
  const priceMap = new Map<string, number>();

  if (useLivePrices) {
    try {
      // Try live prices first
      const instrumentKeyMap = await getInstrumentKeys(symbols);
      const instrumentKeys = Array.from(instrumentKeyMap.values());

      if (instrumentKeys.length > 0) {
        const liveQuotes = await getLiveQuotes(instrumentKeys);

        // Map back to symbols
        for (const [symbol, key] of instrumentKeyMap.entries()) {
          const quote = liveQuotes.get(key);
          if (quote) {
            priceMap.set(symbol, quote.last_price);
          }
        }
      }
    } catch (error) {
      console.warn('[Valuation] Failed to get live prices, falling back to DB:', error);
    }
  }

  // Fill missing prices from DB (batched to avoid SQLite expression tree limit)
  const missingSymbols = symbols.filter((s) => !priceMap.has(s));
  if (missingSymbols.length > 0 || !useLivePrices) {
    const lookupSymbols = useLivePrices ? missingSymbols : symbols;
    
    if (lookupSymbols.length > 0) {
      // Get latest prices from stockHistory (batched)
      const lookupChunks = chunkArray(lookupSymbols);
      const latestDatesArrays = await Promise.all(
        lookupChunks.map(chunk =>
          prisma.stockHistory.groupBy({
            by: ['symbol'],
            where: { symbol: { in: chunk } },
            _max: { date: true },
          })
        )
      );
      const latestDates = latestDatesArrays.flat();

      const orConditions = latestDates
        .filter((ld) => ld._max.date)
        .map((ld) => ({
          symbol: ld.symbol,
          date: ld._max.date!,
        }));
      
      const orChunks = chunkArray(orConditions);
      const latestPricesArrays = await Promise.all(
        orChunks.map(chunk =>
          prisma.stockHistory.findMany({
            where: { OR: chunk },
            select: { symbol: true, close: true },
          })
        )
      );
      const latestPrices = latestPricesArrays.flat();

      for (const p of latestPrices) {
        if (!priceMap.has(p.symbol)) {
          priceMap.set(p.symbol, p.close);
        }
      }
    }
  }

  // 5. Get AMFI categories
  const amfiCategories = await getCategoriesBatch(symbols, referenceDate);

  // 6. Get sector mappings (batched to avoid SQLite expression tree limit)
  // Reuse symbolMappings from earlier to handle renamed/delisted stocks
  
  // Build expanded symbol list (include both old and new symbols)
  const expandedSymbols = new Set(symbols);
  for (const m of symbolMappings) {
    if (symbols.includes(m.oldSymbol)) expandedSymbols.add(m.newSymbol);
    if (symbols.includes(m.newSymbol)) expandedSymbols.add(m.oldSymbol);
  }
  
  const sectorChunks = chunkArray(Array.from(expandedSymbols));
  const sectorMappingsArrays = await Promise.all(
    sectorChunks.map(chunk =>
      prisma.sectorMapping.findMany({
        where: { symbol: { in: chunk } },
        select: { symbol: true, sector: true },
      })
    )
  );
  const sectorMappingsList = sectorMappingsArrays.flat();
  const sectorMap = new Map(sectorMappingsList.map((s) => [s.symbol, s.sector]));
  
  // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
  for (const m of symbolMappings) {
    const oldSector = sectorMap.get(m.oldSymbol);
    const newSector = sectorMap.get(m.newSymbol);
    
    if (oldSector && !newSector) {
      sectorMap.set(m.newSymbol, oldSector);
    } else if (newSector && !oldSector) {
      sectorMap.set(m.oldSymbol, newSector);
    }
  }

  // 7. Calculate valuations
  let totalValue = 0;
  let totalInvested = 0;
  const breakdown = { large: 0, mid: 0, small: 0, micro: 0 };
  const holdings: HoldingValuation[] = [];

  for (const h of activeHoldings) {
    const currentPrice = priceMap.get(h.symbol) || 0;
    const currentValue = h.qty * currentPrice;
    const avgPrice = h.qty > 0 ? h.invested / h.qty : 0;
    const unrealizedPnl = currentValue - h.invested;
    const unrealizedPnlPercent = h.invested > 0 ? (unrealizedPnl / h.invested) * 100 : 0;

    totalValue += currentValue;
    totalInvested += h.invested;

    const category = amfiCategories.get(h.symbol) || 'Small';
    switch (category) {
      case 'Large':
        breakdown.large += currentValue;
        break;
      case 'Mid':
        breakdown.mid += currentValue;
        break;
      case 'Small':
        breakdown.small += currentValue;
        break;
      case 'Micro':
        breakdown.micro += currentValue;
        break;
    }

    holdings.push({
      symbol: h.symbol,
      quantity: h.qty,
      avgPrice,
      currentPrice,
      invested: h.invested,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      marketCapCategory: category,
      sector: sectorMap.get(h.symbol),
    });
  }

  // Sort by current value descending
  holdings.sort((a, b) => b.currentValue - a.currentValue);

  const totalUnrealizedPnl = totalValue - totalInvested;
  const totalUnrealizedPnlPercent = totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0;

  return {
    totalValue,
    totalInvested,
    totalUnrealizedPnl,
    totalUnrealizedPnlPercent,
    holdings,
    marketCapBreakdown: {
      large: {
        value: breakdown.large,
        percentage: totalValue > 0 ? (breakdown.large / totalValue) * 100 : 0,
      },
      mid: {
        value: breakdown.mid,
        percentage: totalValue > 0 ? (breakdown.mid / totalValue) * 100 : 0,
      },
      small: {
        value: breakdown.small,
        percentage: totalValue > 0 ? (breakdown.small / totalValue) * 100 : 0,
      },
      micro: {
        value: breakdown.micro,
        percentage: totalValue > 0 ? (breakdown.micro / totalValue) * 100 : 0,
      },
    },
    lastUpdated: new Date(),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptyValuation(): PortfolioValuation {
  return {
    totalValue: 0,
    totalInvested: 0,
    totalUnrealizedPnl: 0,
    totalUnrealizedPnlPercent: 0,
    holdings: [],
    marketCapBreakdown: {
      large: { value: 0, percentage: 0 },
      mid: { value: 0, percentage: 0 },
      small: { value: 0, percentage: 0 },
      micro: { value: 0, percentage: 0 },
    },
    lastUpdated: new Date(),
  };
}

/**
 * Get just the total portfolio value (lighter weight)
 */
export async function getTotalPortfolioValue(useLivePrices = true): Promise<number> {
  const valuation = await calculatePortfolioValue({ useLivePrices });
  return valuation.totalValue;
}
