/**
 * Zerodha Portfolio & Margins Integration Service
 * Fetches true Demat holdings and real-time cash balances from Kite Connect Free APIs.
 */

import { getAuthenticatedKiteClient } from '@/lib/kite-client';
import { getPortfolioHoldings } from '@/lib/finance/holdings';
import { prisma } from '@/lib/db';
import { getSymbolResolver } from '@/lib/amfi';
import { logger } from '@/lib/logger';
import type { 
    KiteDematHolding, 
    DematReconciliationItem, 
    DematReconciliationSummary, 
    DematReconciliationResult,
    BrokerCashMetrics 
} from '@/lib/types';

const portfolioLogger = logger.scope('ZerodhaPortfolio');

/**
 * Fetch raw Demat holdings directly from Zerodha Kite Connect
 */
export async function fetchZerodhaHoldings(): Promise<KiteDematHolding[]> {
    try {
        const kc = await getAuthenticatedKiteClient();
        portfolioLogger.info('Fetching Demat holdings from Zerodha...');
        const rawHoldings = await kc.getHoldings();

        if (!Array.isArray(rawHoldings)) {
            portfolioLogger.warn('Invalid holdings response from Zerodha:', rawHoldings);
            return [];
        }

        portfolioLogger.info(`Retrieved ${rawHoldings.length} Demat holdings from Zerodha.`);

        return rawHoldings.map((h: any) => ({
            symbol: h.tradingsymbol,
            exchange: h.exchange,
            isin: h.isin,
            quantity: Number(h.quantity || 0),
            t1Quantity: Number(h.t1_quantity || 0),
            realisedQuantity: Number(h.realised_quantity || 0),
            authorisedQuantity: Number(h.authorised_quantity || 0),
            averagePrice: Number(h.average_price || 0),
            lastPrice: Number(h.last_price || 0),
            closePrice: Number(h.close_price || 0),
            pnl: Number(h.pnl || 0),
            pledgedQuantity: Number(h.pledged_quantity || 0),
            collateralQuantity: Number(h.collateral_quantity || 0),
            collateralType: h.collateral_type,
            discrepancy: Boolean(h.discrepancy),
        }));
    } catch (error) {
        portfolioLogger.error('Failed to fetch Demat holdings:', error);
        throw error;
    }
}

/**
 * Fetch available cash and margin balances from Zerodha Kite Connect
 * (Strictly informational: NEVER factored into NAV or XIRR)
 */
export async function fetchZerodhaMargins(): Promise<BrokerCashMetrics> {
    try {
        const kc = await getAuthenticatedKiteClient();
        portfolioLogger.info('Fetching margin and cash funds from Zerodha...');
        const margins = await kc.getMargins('equity');

        const equityMargin = (margins as any)?.equity || margins;
        const available = equityMargin?.available || {};
        const utilised = equityMargin?.utilised || {};

        return {
            availableCash: Number(available.cash ?? 0),
            collateralMargin: Number(available.collateral ?? 0),
            liveBalance: Number(available.live_balance ?? available.cash ?? 0),
            utilisedDebits: Number(utilised.debits ?? 0),
            holdingSales: Number(utilised.holding_sales ?? 0),
            net: Number(equityMargin?.net ?? 0),
            lastUpdated: new Date().toISOString(),
        };
    } catch (error) {
        portfolioLogger.error('Failed to fetch Zerodha margins:', error);
        throw error;
    }
}

/**
 * Reconcile Alpha's calculated portfolio holdings with Zerodha Demat holdings
 */
export async function reconcilePortfolioWithZerodha(): Promise<DematReconciliationResult> {
    portfolioLogger.info('Starting portfolio reconciliation with Zerodha Demat...');

    // 1. Fetch both datasets in parallel
    const [alphaHoldings, dematHoldings, symbolMappings] = await Promise.all([
        getPortfolioHoldings(),
        fetchZerodhaHoldings(),
        prisma.symbolMapping.findMany(),
    ]);

    const resolveSymbol = getSymbolResolver(symbolMappings);

    // 2. Fetch company names from AMFI
    const allSymbols = new Set<string>();
    alphaHoldings.forEach(h => allSymbols.add(h.symbol));
    dematHoldings.forEach(h => allSymbols.add(resolveSymbol(h.symbol)));

    const amfiRows = await prisma.aMFIClassification.findMany({
        where: { symbol: { in: Array.from(allSymbols) } },
        orderBy: { period: 'desc' },
        select: { symbol: true, companyName: true },
    });

    const companyNameMap = new Map<string, string>();
    for (const row of amfiRows) {
        if (!companyNameMap.has(row.symbol)) {
            companyNameMap.set(row.symbol, row.companyName);
        }
    }

    // 3. Index Alpha holdings by resolved symbol
    const alphaMap = new Map<string, typeof alphaHoldings[0]>();
    for (const h of alphaHoldings) {
        const canonical = resolveSymbol(h.symbol);
        alphaMap.set(canonical, h);
    }

    // 4. Index Demat holdings by resolved symbol
    const dematMap = new Map<string, KiteDematHolding>();
    for (const h of dematHoldings) {
        const canonical = resolveSymbol(h.symbol);
        // Combine if multiple listings exist (e.g. NSE + BSE)
        const existing = dematMap.get(canonical);
        if (existing) {
            existing.quantity += h.quantity;
            existing.t1Quantity += h.t1Quantity;
            existing.pledgedQuantity += h.pledgedQuantity;
            existing.realisedQuantity += h.realisedQuantity;
            // Weighted average price
            const totalQty = existing.quantity;
            if (totalQty > 0) {
                existing.averagePrice = ((existing.averagePrice * (existing.quantity - h.quantity)) + (h.averagePrice * h.quantity)) / totalQty;
            }
        } else {
            dematMap.set(canonical, { ...h, symbol: canonical });
        }
    }

    // 5. Compare & build reconciliation list
    const items: DematReconciliationItem[] = [];
    const processedSymbols = new Set<string>();

    // Check all Alpha holdings
    for (const [sym, alpha] of alphaMap.entries()) {
        processedSymbols.add(sym);
        const demat = dematMap.get(sym);

        const alphaQty = alpha.quantity;
        const dematQty = demat?.quantity ?? 0;
        const deltaQty = dematQty - alphaQty;
        const diffAbs = Math.abs(deltaQty);

        const currentPrice = demat?.lastPrice && demat.lastPrice > 0 ? demat.lastPrice : alpha.price;
        const alphaAvgPrice = alpha.invested > 0 && alphaQty > 0 ? alpha.invested / alphaQty : 0;
        const dematAvgPrice = demat?.averagePrice ?? 0;
        const t1Qty = demat?.t1Quantity ?? 0;
        const pledgedQty = demat?.pledgedQuantity ?? 0;

        let status: DematReconciliationItem['status'];
        let potentialReason: string | undefined;

        if (dematQty === 0) {
            status = 'missing_in_demat';
            potentialReason = 'Stock exists in Alpha ledger but zero balance in Demat. (May have been sold outside Alpha or transferred).';
        } else if (diffAbs < 0.001) {
            status = 'matched';
            if (t1Qty > 0) {
                potentialReason = `${t1Qty} shares pending T+1 settlement.`;
            } else if (pledgedQty > 0) {
                potentialReason = `${pledgedQty} shares pledged as collateral.`;
            }
        } else {
            status = 'discrepancy';
            // Detect common corporate action multiples
            if (alphaQty > 0) {
                const ratio = dematQty / alphaQty;
                if (Math.abs(ratio - 2) < 0.05) potentialReason = 'Likely 1:1 Stock Split or Bonus';
                else if (Math.abs(ratio - 3) < 0.05) potentialReason = 'Likely 2:1 Stock Split or Bonus';
                else if (Math.abs(ratio - 5) < 0.05) potentialReason = 'Likely 5:1 Stock Split';
                else if (Math.abs(ratio - 10) < 0.05) potentialReason = 'Likely 10:1 Stock Split';
                else if (t1Qty > 0 && Math.abs(diffAbs - t1Qty) < 0.001) {
                    potentialReason = `Discrepancy matches unsettled T+1 shares (${t1Qty}).`;
                }
            }
        }

        const alphaValue = alphaQty * currentPrice;
        const dematValue = dematQty * currentPrice;
        const valueDiff = dematValue - alphaValue;

        items.push({
            symbol: sym,
            companyName: companyNameMap.get(sym) || sym,
            alphaQty,
            dematQty,
            deltaQty,
            t1Qty,
            pledgedQty,
            alphaAvgPrice,
            dematAvgPrice,
            currentPrice,
            alphaValue,
            dematValue,
            valueDiff,
            status,
            potentialReason,
        });
    }

    // Check Demat holdings missing in Alpha
    for (const [sym, demat] of dematMap.entries()) {
        if (processedSymbols.has(sym)) continue;

        const alphaQty = 0;
        const dematQty = demat.quantity;
        const deltaQty = dematQty;
        const currentPrice = demat.lastPrice > 0 ? demat.lastPrice : demat.closePrice;
        const dematValue = dematQty * currentPrice;

        items.push({
            symbol: sym,
            companyName: companyNameMap.get(sym) || sym,
            alphaQty,
            dematQty,
            deltaQty,
            t1Qty: demat.t1Quantity,
            pledgedQty: demat.pledgedQuantity,
            alphaAvgPrice: 0,
            dematAvgPrice: demat.averagePrice,
            currentPrice,
            alphaValue: 0,
            dematValue,
            valueDiff: dematValue,
            status: 'missing_in_alpha',
            potentialReason: 'Demat holding has no corresponding transactions in Alpha.',
        });
    }

    // 6. Sort items: Discrepancies first, then Missing in Alpha, Missing in Demat, then Matched (by value descending)
    const statusPriority: Record<DematReconciliationItem['status'], number> = {
        discrepancy: 1,
        missing_in_alpha: 2,
        missing_in_demat: 3,
        matched: 4,
    };

    items.sort((a, b) => {
        const pDiff = statusPriority[a.status] - statusPriority[b.status];
        if (pDiff !== 0) return pDiff;
        return Math.abs(b.valueDiff) - Math.abs(a.valueDiff);
    });

    // 7. Aggregate Summary
    let totalDematValue = 0;
    let totalAlphaValue = 0;
    let matchedCount = 0;
    let discrepancyCount = 0;
    let missingInAlphaCount = 0;
    let missingInDematCount = 0;
    let totalT1Shares = 0;
    let totalPledgedShares = 0;

    for (const it of items) {
        totalDematValue += it.dematValue;
        totalAlphaValue += it.alphaValue;
        totalT1Shares += it.t1Qty;
        totalPledgedShares += it.pledgedQty;

        if (it.status === 'matched') matchedCount++;
        else if (it.status === 'discrepancy') discrepancyCount++;
        else if (it.status === 'missing_in_alpha') missingInAlphaCount++;
        else if (it.status === 'missing_in_demat') missingInDematCount++;
    }

    const summary: DematReconciliationSummary = {
        totalDematValue,
        totalAlphaValue,
        netDifferenceValue: totalDematValue - totalAlphaValue,
        totalDematStocks: dematMap.size,
        totalAlphaStocks: alphaMap.size,
        matchedCount,
        discrepancyCount,
        missingInAlphaCount,
        missingInDematCount,
        totalT1Shares,
        totalPledgedShares,
        lastSyncedAt: new Date().toISOString(),
    };

    portfolioLogger.info(`Reconciliation complete. Matched: ${matchedCount}, Discrepancies: ${discrepancyCount}, Missing in Alpha: ${missingInAlphaCount}, Missing in Demat: ${missingInDematCount}`);

    return { items, summary };
}
