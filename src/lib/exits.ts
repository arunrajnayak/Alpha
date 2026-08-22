import { prisma } from '@/lib/db';
import { differenceInCalendarDays } from 'date-fns';
import type { MarketCapCategory } from './amfi';
import { getCategoriesBatch, mapAMFIToMarketCapCategory, getSymbolResolver } from './amfi';
import { calculateBrokerageCharges, calculateCapitalGainsTax, ChargesBreakdown, TaxBreakdown } from './charges';
import { orderTransactionsForReplay } from './portfolio-engine';

export interface ExitRecord {
    id: string; // Composite ID
    symbol: string;
    sellDate: Date;
    quantity: number; // Avg or cumulative? Cumulative for the cycle.
    buyDate: Date; // Initial buy date of the cycle
    buyPrice: number; // Avg buy price
    sellPrice: number; // Avg sell price
    changePercent: number;
    gainLoss: number;           // Gross P&L (before charges & tax)
    timeHeld: number; // Days
    marketCapCategory?: MarketCapCategory;
    // Computed cost fields
    chargesBreakdown?: ChargesBreakdown; // Itemized transaction charges
    taxBreakdown?: TaxBreakdown;         // STCG or LTCG tax
    netGainLoss?: number;                // gainLoss - totalCharges - taxAmount
}

interface TradeCycle {
    symbol: string;
    startDate: Date;
    totalBoughtQty: number; 
    totalCost: number; // needed for cycle tracking
    cumulativeCost: number;     
    cumulativeRevenue: number;  
    cumulativeSoldQty: number;
    currentQty: number;
    // To handle splits correctly, we need to adjust 'totalBoughtQty' AND 'currentQty'.
    // cumulativeCost stays same (you paid what you paid).
}

export async function getPortfolioExits(): Promise<ExitRecord[]> {
    const transactionsRaw = await prisma.transaction.findMany({
        orderBy: { date: 'asc' }
    });

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);
    // Order same-day events BUY-before-SELL so intraday buy/sell pairs are paired
    // correctly and don't corrupt exit-cycle tracking (see orderTransactionsForReplay).
    const transactions = orderTransactionsForReplay(
        transactionsRaw.map(t => ({
            ...t,
            symbol: resolveSymbol(t.symbol)
        }))
    );

    // Batch fetch AMFI categories for all symbols in transactions
    const uniqueSymbols = Array.from(new Set(transactions.map(t => t.symbol)));
    const categoriesMap = await getCategoriesBatch(uniqueSymbols);

    const exits: ExitRecord[] = [];
    // Active cycles: Map<Symbol, Cycle>
    const cycles = new Map<string, TradeCycle>();

    for (const tx of transactions) {
        const existingCycle = cycles.get(tx.symbol);

        if (tx.type === 'BUY') {
            let cycle = existingCycle;
            if (!cycle) {
                // New Cycle Start
                cycle = {
                    symbol: tx.symbol,
                    startDate: tx.date,
                    totalBoughtQty: 0,
                    totalCost: 0,
                    cumulativeCost: 0,
                    cumulativeRevenue: 0,
                    cumulativeSoldQty: 0,
                    currentQty: 0
                };
                cycles.set(tx.symbol, cycle);
            }
            
            cycle!.totalBoughtQty += tx.quantity;
            cycle!.totalCost += (tx.quantity * tx.price);
            cycle!.cumulativeCost += (tx.quantity * tx.price);
            cycle!.currentQty += tx.quantity;

        } else if (tx.type === 'SELL') {
            if (existingCycle) {
                existingCycle.cumulativeRevenue += (tx.quantity * tx.price);
                existingCycle.cumulativeSoldQty += tx.quantity;
                existingCycle.currentQty -= tx.quantity;

                // Precision check for zero
                if (existingCycle.currentQty <= 0.0001) {
                    // EXIT DETECTED
                    const buyPrice = existingCycle.cumulativeCost / existingCycle.totalBoughtQty;
                    const sellPrice = existingCycle.cumulativeRevenue / existingCycle.cumulativeSoldQty;
                    const gainLoss = existingCycle.cumulativeRevenue - existingCycle.cumulativeCost;
                    const changePercent = (gainLoss / existingCycle.cumulativeCost) * 100;
                    const days = differenceInCalendarDays(tx.date, existingCycle.startDate);

                    // Get Market Cap Category from AMFI classification
                    // AMFI provides official Large/Mid/Small cap classification
                    const amfiCategory = categoriesMap.get(tx.symbol) || 'Small';
                    const marketCapCategory = mapAMFIToMarketCapCategory(amfiCategory);

                    // Compute charges and tax
                    const buyValue = existingCycle.cumulativeCost;
                    const sellValue = existingCycle.cumulativeRevenue;
                    const chargesBreakdown = calculateBrokerageCharges(buyValue, sellValue);
                    const taxBreakdown = calculateCapitalGainsTax(gainLoss, days);
                    const netGainLoss = gainLoss - chargesBreakdown.totalCharges - taxBreakdown.taxAmount;

                    exits.push({
                        id: `${tx.symbol}-${tx.date.toISOString()}`,
                        symbol: tx.symbol,
                        sellDate: tx.date,
                        quantity: existingCycle.totalBoughtQty, // Total volume traded in this cycle
                        buyDate: existingCycle.startDate,
                        buyPrice,
                        sellPrice,
                        changePercent,
                        gainLoss,
                        timeHeld: days,
                        marketCapCategory,
                        chargesBreakdown,
                        taxBreakdown,
                        netGainLoss,
                    });

                    // Clear cycle
                    cycles.delete(tx.symbol);
                }
            }
        } else if (tx.type === 'SPLIT' || tx.type === 'BONUS') {
            if (existingCycle) {
                const ratio = tx.splitRatio || 1;
                // Adjust Qty. Cost remains same.
                existingCycle.totalBoughtQty *= ratio;
                existingCycle.currentQty *= ratio;
                existingCycle.cumulativeSoldQty *= ratio;
            }
        } else if (tx.type === 'SYMBOL_CHANGE') {
            if (existingCycle && tx.newSymbol) {
                const newCycle = { ...existingCycle, symbol: tx.newSymbol };
                cycles.delete(tx.symbol);
                cycles.set(tx.newSymbol, newCycle);
            }
        }
    }

    // Sort by Sell Date Descending
    return exits.sort((a, b) => b.sellDate.getTime() - a.sellDate.getTime());
}
