import { prisma, chunkArray } from '@/lib/db';
import { startOfDay, format, differenceInDays, parse as parseDateFns } from 'date-fns';
import xirr from 'xirr';
import { unstable_cache } from 'next/cache';
import { getInstrumentKeys } from '../instrument-service';
import { getLTP, hasValidToken } from '../upstox-client';
import { getAMFICategoriesBatch, mapAMFIToMarketCapCategory } from '../amfi';
import { isMarketOpenAsync } from '../marketHours';
import { financeLogger } from '@/lib/logger';
import { fetchNSECorporateActions } from '@/lib/nse-api';
import { computePortfolioState } from './recalculation';
import { Holding, MarketCapResult } from './types';
import { getDividendTotalBySymbol } from '../dividends';

// Feature flag for Upstox migration - set to true to use Upstox as primary data source
const USE_UPSTOX = process.env.USE_UPSTOX !== 'false'; // Default to true

async function getPortfolioHoldingsInternal(options?: { useLivePrices?: boolean }) {
    const engine = await computePortfolioState();

    const activeHoldings: { symbol: string; quantity: number; invested: number }[] = [];
    for (const [symbol, data] of engine.holdings) {
        if (data.qty > 0.01) {
             activeHoldings.push({ symbol, quantity: data.qty, invested: data.invested });
        }
    }

    if (activeHoldings.length === 0) {
        return [];
    }

    const symbols = activeHoldings.map(h => h.symbol);

    // Batch fetch latest prices for all active holdings (batched to avoid SQLite expression tree limit)
    const priceChunks = chunkArray(symbols);
    const latestDatesArrays = await Promise.all(
        priceChunks.map(chunk =>
            prisma.stockHistory.groupBy({
                by: ['symbol'],
                where: { symbol: { in: chunk } },
                _max: { date: true }
            })
        )
    );
    const latestDates = latestDatesArrays.flat();

    // Batch the OR conditions for latest prices
    const orConditions = latestDates.map(ld => ({
        symbol: ld.symbol,
        date: ld._max.date!
    }));
    const orChunks = chunkArray(orConditions);
    const latestPricesArrays = await Promise.all(
        orChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { OR: chunk },
                select: { symbol: true, close: true }
            })
        )
    );
    const latestPrices = latestPricesArrays.flat();

    const priceMap = new Map<string, number>();
    for (const p of latestPrices) {
        priceMap.set(p.symbol, p.close);
    }

    // Optionally fetch live prices (LTP) during market hours
    let livePriceMap: Map<string, number> | null = null;
    if (options?.useLivePrices && USE_UPSTOX) {
        try {
            const instrumentKeyMap = await getInstrumentKeys(symbols);
            const instrumentKeys = Array.from(instrumentKeyMap.values());

            if (instrumentKeys.length > 0) {
                const ltpMap = await getLTP(instrumentKeys);
                livePriceMap = new Map<string, number>();

                for (const [symbol, key] of instrumentKeyMap.entries()) {
                    const price = ltpMap.get(key);
                    if (price !== undefined) {
                        livePriceMap.set(symbol, price);
                    }
                }
            }
        } catch (error) {
            financeLogger.warn('[Portfolio] Live price fetch failed, falling back to latest close:', error);
        }
    }

    // Fetch sector mappings (batched to avoid SQLite expression tree limit)
    // Also fetch symbol mappings to handle renamed/delisted stocks
    let sectorMap = new Map<string, string>();
    try {
        // Get symbol mappings first
        const symbolMappingsForSector = await prisma.symbolMapping.findMany();

        // Build expanded symbol list (include both old and new symbols)
        const expandedSymbols = new Set(symbols);
        for (const m of symbolMappingsForSector) {
            if (symbols.includes(m.oldSymbol)) expandedSymbols.add(m.newSymbol);
            if (symbols.includes(m.newSymbol)) expandedSymbols.add(m.oldSymbol);
        }

        const sectorChunks = chunkArray(Array.from(expandedSymbols));
        const sectorMappingsArrays = await Promise.all(
            sectorChunks.map(chunk =>
                prisma.sectorMapping.findMany({
                    where: { symbol: { in: chunk } },
                    select: { symbol: true, sector: true }
                })
            )
        );
        const sectorMappings = sectorMappingsArrays.flat();
        sectorMap = new Map(sectorMappings.map((s: { symbol: string; sector: string }) => [s.symbol, s.sector]));

        // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
        for (const m of symbolMappingsForSector) {
            const oldSector = sectorMap.get(m.oldSymbol);
            const newSector = sectorMap.get(m.newSymbol);

            if (oldSector && !newSector) {
                sectorMap.set(m.newSymbol, oldSector);
            } else if (newSector && !oldSector) {
                sectorMap.set(m.oldSymbol, newSector);
            }
        }
        financeLogger.info(`[Portfolio] Fetched ${sectorMappings.length} sector mappings, extended to ${sectorMap.size} for ${symbols.length} symbols`);
    } catch (error) {
        // Table may not exist yet - continue without sector data
        financeLogger.warn('[Portfolio] Sector lookup failed:', (error as Error).message);
    }

    // Fetch AMFI market cap classifications
    const amfiCategories = await getAMFICategoriesBatch(symbols);

    const today = startOfDay(new Date());
    const holdingPeriodDaysMap = new Map<string, number>();
    for (const [symbol, batches] of engine.inventory.entries()) {
        if (!batches || batches.length === 0) continue;
        let totalQty = 0;
        let weightedDays = 0;
        for (const batch of batches) {
            if (batch.qty <= 0) continue;
            const days = differenceInDays(today, startOfDay(batch.date));
            weightedDays += days * batch.qty;
            totalQty += batch.qty;
        }
        if (totalQty > 0) {
            holdingPeriodDaysMap.set(symbol, Math.round(weightedDays / totalQty));
        }
    }

    // Build final holdings array
    const validHoldings = activeHoldings.map(h => {
        const price = livePriceMap?.get(h.symbol) ?? priceMap.get(h.symbol) ?? 0;
        const currentValue = h.quantity * price;
        const pnl = currentValue - h.invested;
        const pnlPercent = h.invested > 0 ? (pnl / h.invested) * 100 : 0;

        // Get market cap category from AMFI classification
        const amfiCategory = amfiCategories.get(h.symbol);
        const marketCapCategory = mapAMFIToMarketCapCategory(amfiCategory || 'Small');

        return {
            symbol: h.symbol,
            quantity: h.quantity,
            invested: h.invested,
            currentValue,
            price,
            pnl,
            pnlPercent,
            marketCap: 0, // No longer fetching raw market cap value
            marketCapCategory,
            sector: sectorMap.get(h.symbol),
            holdingPeriodDays: holdingPeriodDaysMap.get(h.symbol)
        };
    });

    // Enrich with upcoming demerger alerts (next 90 days)
    try {
      const now = new Date();
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + 90);
      const demergerActions = await fetchNSECorporateActions(now, futureDate, 'DEMERGER');
      if (demergerActions && demergerActions.length > 0) {
        const holdingSymbols = new Set(validHoldings.map(h => h.symbol));
        for (const action of demergerActions) {
          if (action.series !== 'EQ' || !holdingSymbols.has(action.symbol)) continue;
          // Parse NSE date "24-Apr-2025"
          const exDate = parseDateFns(action.exDate, 'dd-MMM-yyyy', new Date());
          if (isNaN(exDate.getTime())) continue;
          const daysUntil = differenceInDays(exDate, now);
          if (daysUntil < 0) continue; // Already past
          const holding = validHoldings.find(h => h.symbol === action.symbol);
          if (holding) {
            (holding as Record<string, unknown>).upcomingDemerger = {
              exDate: format(exDate, 'dd-MMM-yyyy'),
              daysUntil,
            };
          }
        }
      }
    } catch (err) {
      financeLogger.warn('[Portfolio] Upcoming demerger check failed:', (err as Error).message);
    }

    return validHoldings.sort((a, b) => b.currentValue - a.currentValue);
}

const getPortfolioHoldingsCached = unstable_cache(
    getPortfolioHoldingsInternal,
    ['portfolio-holdings-list'],
    { tags: ['portfolio-data'], revalidate: 300 }
);

export async function getPortfolioHoldings() {
    // Use live prices during market hours when Upstox token is available
    const [hasToken, marketOpen] = await Promise.all([
        hasValidToken(),
        isMarketOpenAsync()
    ]);

    if (USE_UPSTOX && hasToken && marketOpen) {
        return getPortfolioHoldingsInternal({ useLivePrices: true });
    }

    return getPortfolioHoldingsCached();
}

// Fetch 1-year price history for sparkline charts
export async function getStockPriceHistory(symbols: string[]): Promise<Map<string, { date: string; close: number }[]>> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Batch queries to avoid SQLite expression tree limit
    const historyChunks = chunkArray(symbols);
    const historyArrays = await Promise.all(
        historyChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: {
                    symbol: { in: chunk },
                    date: { gte: oneYearAgo }
                },
                orderBy: { date: 'asc' }
            })
        )
    );
    const history = historyArrays.flat();

    // Group by symbol and sample to ~52 data points (weekly)
    const result = new Map<string, { date: string; close: number }[]>();

    for (const symbol of symbols) {
        const symbolHistory = history.filter(h => h.symbol === symbol);

        // Sample to weekly data points for performance
        const step = Math.max(1, Math.floor(symbolHistory.length / 52));
        const sampled = symbolHistory
            .filter((_, i) => i % step === 0 || i === symbolHistory.length - 1)
            .map(h => ({
                date: format(h.date, 'yyyy-MM-dd'),
                close: h.close
            }));

        result.set(symbol, sampled);
    }

    return result;
}

async function getHistoricalPortfolioHoldingsInternal() {
    const engine = await computePortfolioState();

    const symbols = Array.from(engine.holdings.keys());

    if (symbols.length === 0) {
        return [];
    }

    // Batch fetch all latest prices (batched to avoid SQLite expression tree limit)
    const histPriceChunks = chunkArray(symbols);
    const latestDatesArrays = await Promise.all(
        histPriceChunks.map(chunk =>
            prisma.stockHistory.groupBy({
                by: ['symbol'],
                where: { symbol: { in: chunk } },
                _max: { date: true }
            })
        )
    );
    const latestDates = latestDatesArrays.flat();

    const orConditions = latestDates
        .filter(ld => ld._max.date !== null)
        .map(ld => ({
            symbol: ld.symbol,
            date: ld._max.date!
        }));
    const orChunks = chunkArray(orConditions);
    const latestPricesArrays = await Promise.all(
        orChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { OR: chunk },
                select: { symbol: true, close: true }
            })
        )
    );
    const latestPrices = latestPricesArrays.flat();

    const priceMap = new Map<string, number>();
    for (const p of latestPrices) {
        priceMap.set(p.symbol, p.close);
    }

    // Fetch dividends per symbol
    const dividendMap = await getDividendTotalBySymbol().catch(() => new Map<string, number>());

    const finalHoldings = symbols.map(sym => {
        const h = engine.holdings.get(sym)!;
        const currentPrice = priceMap.get(sym) || 0;

        const safeQty = Math.abs(h.qty) < 0.01 ? 0 : h.qty;
        const safeCurrentVal = safeQty * currentPrice;
        const safeCostOfHeld = Math.abs(h.qty) < 0.01 ? 0 : h.invested;

        const unrealizedPnl = safeCurrentVal - safeCostOfHeld;
        const dividends = dividendMap.get(sym) || 0;
        const totalPnl = h.realizedPnl + unrealizedPnl + dividends;

        return {
            symbol: sym,
            quantity: safeQty,
            currentPrice,
            currentValue: safeCurrentVal,
            invested: safeCostOfHeld,
            realizedPnl: h.realizedPnl,
            unrealizedPnl: unrealizedPnl,
            totalPnl: totalPnl,
            dividends: dividends
        };
    });

    return finalHoldings.sort((a, b) => b.totalPnl - a.totalPnl);
}

// Keep a placeholder for the rest to be deleted in part 2 if needed

export const getHistoricalPortfolioHoldings = unstable_cache(
    getHistoricalPortfolioHoldingsInternal,
    ['portfolio-historical-holdings'],
    { tags: ['portfolio-data'], revalidate: 3600 }
);


async function calculatePortfolioXIRRInternal(currentValue: number) {
    const transactions = await prisma.transaction.findMany({});
    // Flow: -BuyAmount, +SellAmount
    // And finally +CurrentValuation at today.

    if (transactions.length === 0) return 0;

    const flows = transactions.map((t) => ({
        amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
        when: t.date
    }));

    // Add current valuation
    flows.push({
        amount: currentValue,
        when: new Date()
    });

    try {
        const rate = xirr(flows);
        return rate * 100; // Convert to percentage
    } catch (e) {
        financeLogger.error("XIRR Calculation failed:", e);
        return 0;
    }
}

export const calculatePortfolioXIRR = unstable_cache(
    calculatePortfolioXIRRInternal,
    ['portfolio-xirr'],
    { tags: ['portfolio-data'], revalidate: 3600 }
);

// Shared helper for market cap segmentation with concurrent fetching
export async function computeMarketCapSegmentation(
    holdings: Holding[]
): Promise<MarketCapResult> {
    // Fetch AMFI classifications for all holdings
    const symbols = holdings.map(h => h.symbol);
    const amfiCategories = await getAMFICategoriesBatch(symbols);

    let large = 0, mid = 0, small = 0, micro = 0;

    for (const holding of holdings) {
        const amfiCategory = amfiCategories.get(holding.symbol) || 'Small';
        const category = mapAMFIToMarketCapCategory(amfiCategory);

        switch (category) {
            case 'Large': large += holding.currentValue; break;
            case 'Mid': mid += holding.currentValue; break;
            case 'Small': small += holding.currentValue; break;
            case 'Micro': micro += holding.currentValue; break;
        }
    }

    return { large, mid, small, micro };
}
