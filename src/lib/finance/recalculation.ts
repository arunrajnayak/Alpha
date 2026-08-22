// ============================================================================
// PORTFOLIO RECALCULATION - Finance Module
// ============================================================================

import { prisma, chunkArray } from '@/lib/db';
import { addDays, isSameDay, startOfDay, format, differenceInDays, max as dateMax, subDays, isWeekend } from 'date-fns';
import { revalidateTag } from 'next/cache';
import { PortfolioEngine, orderTransactionsForReplay } from '../portfolio-engine';
import { getDataLockDate } from '../config';
import { SectorAllocation } from '../types';
import { getSymbolResolver } from '../amfi';
import { getAMFICategoriesBatch, mapAMFIToMarketCapCategory, getCurrentAMFIPeriod, AMFICategory } from '../amfi';
import { roundPrice, roundPercent, roundQuantity, roundEquity } from '../precision-utils';
import { getMarketHolidays, getSpecialTradingDays } from '../upstox/market-info';
import { getMarketStatus } from '../market-holidays-cache';
import { updateJob, failJob, completeJob } from '../jobs';
import { financeLogger } from '@/lib/logger';
import { RequestCache, SectorMapping, ProgressCallback } from './types';
import { updateStockHistory } from './stock-history';
import { updateIndexHistory } from './index-history';
import xirr from 'xirr';

// Named constants for business logic thresholds
const NAV_MA_WINDOW = 200; // 200-day moving average window

export async function computePortfolioState(toDate?: Date) {
    const transactions = await prisma.transaction.findMany({
        where: toDate ? { date: { lte: toDate } } : undefined,
        orderBy: { date: 'asc' }
    });

    const engine = new PortfolioEngine();

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);

    // Process all transactions (SPLIT/BONUS are handled directly by processTransaction).
    // Order same-day events BUY-before-SELL so intraday buy/sell pairs don't leave
    // phantom holdings (see orderTransactionsForReplay).
    const orderedTransactions = orderTransactionsForReplay(
        transactions.map(tx => ({ ...tx, symbol: resolveSymbol(tx.symbol) }))
    );
    for (const tx of orderedTransactions) {
        engine.processTransaction(tx);
    }

    financeLogger.info(`[PortfolioState] Final Holdings: ${engine.holdings.size}, Invested Capital: ${engine.investedCapital.toFixed(2)}`);
    return engine;
}

export async function recalculatePortfolioHistoryInternal(
    fromDate?: Date,
    onProgress?: ProgressCallback,
    options?: { forceNSE?: boolean; forceSymbol?: string }
) {

    financeLogger.info("Starting Portfolio Recalculation (TWR + Cashflow)...");
    onProgress?.("Fetching Transactions...", 5);

    // 1. Get all events
    const transactionsRaw = await prisma.transaction.findMany({
        orderBy: { date: 'asc' }
    });

    // Normalize symbols using SymbolMapping
    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);
    // Order same-day events BUY-before-SELL to avoid phantom holdings from
    // intraday buy/sell pairs (see orderTransactionsForReplay).
    const transactions = orderTransactionsForReplay(
        transactionsRaw.map(t => ({
            ...t,
            symbol: resolveSymbol(t.symbol)
        }))
    );


    if (transactions.length === 0) {
        // Clear snapshots if no data
        await prisma.dailyPortfolioSnapshot.deleteMany({});
        await prisma.weeklyPortfolioSnapshot.deleteMany({});
        await prisma.monthlyPortfolioSnapshot.deleteMany({});
        financeLogger.info("No data found. Cleared snapshots.");
        return;
    }

    financeLogger.info(`[Recalc] Data Loaded: ${transactions.length} transactions.`);

    // Determine Start Date
    const txStart = transactions.length > 0 ? transactions[0].date : new Date(2100, 0, 1);
    const startDate = startOfDay(txStart);
    let today = startOfDay(new Date());

    // If market is currently open (trading day, within market hours), exclude today
    // from the simulation to avoid creating snapshots with incomplete/stale intraday data.
    const marketStatus = await getMarketStatus();
    if (marketStatus.isOpen) {
        financeLogger.info(`[Recalc] Market is currently open — excluding today from snapshot generation.`);
        today = startOfDay(subDays(new Date(), 1));
    }

    const SNAPSHOT_START_DATE = process.env.SNAPSHOT_START_DATE
      ? new Date(process.env.SNAPSHOT_START_DATE + 'T00:00:00.000Z')
      : new Date('2026-01-01T00:00:00.000Z');

    const effectiveFromDate = fromDate ? startOfDay(fromDate) : startDate;

    const requestCache: RequestCache = new Map();

    // 2. Identify all symbols for history fetching
    const txSymbols = new Set(transactions.map((t) => t.symbol));



    // Include Mapped Symbols (Ensure we fetch history for both Old and New names)
    try {
        const mappings = await prisma.symbolMapping.findMany();
        for (const m of mappings) {
            if (txSymbols.has(m.oldSymbol)) {
                 txSymbols.add(m.newSymbol);
            } else if (txSymbols.has(m.newSymbol)) {
                 txSymbols.add(m.oldSymbol);
            }
        }
    } catch (e) {
        financeLogger.error("Failed to load symbol mappings during recalc setup", e);
    }

    const symbols = Array.from(txSymbols);
    financeLogger.info(`[Recalc] Symbols to track: ${symbols.length} (From Txs: ${symbols.length})`);

    // 3. Update History IF needed (usually best to update anyway if partial)
    if (symbols.length > 0) {
        onProgress?.("Fetching Stock History & Corporate Actions...", 10);
        // We should ensure history up to today is present
        await updateStockHistory(symbols, startDate, requestCache, options);

        // DISABLE YAHOO CORPORATE ACTIONS (Moving to Manual Mode)
        // await fetchCorporateActions(symbols, startDate, requestCache);
    }
    await updateIndexHistory(startDate);

    // Fetch market holidays for the simulation period
    let marketHolidays = new Set<string>();
    const specialTradingDays = new Set<string>();
    try {
        const holidays = await getMarketHolidays();
        marketHolidays = new Set(holidays.map(h => format(new Date(h.date), 'yyyy-MM-dd')));

        // Also fetch special sessions (e.g. Budget Day Sunday) for relevant years
        // We broadly check the simulation range years
        const startYear = startDate.getFullYear();
        const endYear = today.getFullYear();
        for (let y = startYear; y <= endYear; y++) {
             const special = await getSpecialTradingDays(y);
             for (const d of special) specialTradingDays.add(d);
        }

        financeLogger.info(`[Recalc] Loaded ${marketHolidays.size} market holidays and ${specialTradingDays.size} special trading sessions`);
    } catch (e) {
        financeLogger.warn('[Recalc] Failed to load market holidays, will skip only weekends:', e);
    }

    // Helper to check if a date is a trading day
    const isTradingDay = (date: Date): boolean => {
        const dateStr = format(date, 'yyyy-MM-dd');

        // Check explicit Special Trading Sessions from API (e.g. Budget Day on Sunday, Muhurat Trading)
        // These are confirmed by the Upstox API and take precedence over weekend/holiday rules
        if (specialTradingDays.has(dateStr)) return true;

        // Skip weekends — even if we have price data (price data on a weekend is a data quality
        // issue, e.g. a Saturday UTC price shifting into Sunday IST via the +5:30 offset).
        // We do NOT use `hasPrices` alone to override this check, because stale/bad upstream
        // data can create Sunday entries and would otherwise produce phantom P/L snapshots.
        if (isWeekend(date)) return false;

        // Skip market holidays (trading holidays where NSE is closed)
        if (marketHolidays.has(dateStr)) return false;

        // For regular weekdays: allow if we have actual price data, or assume it's a trading day
        return true;
    };



    // 3b. Corporate Actions are now stored in Transaction table (type='SPLIT' or 'BONUS')
    // They are processed automatically by engine.processTransaction()
    // This map is kept for backward compatibility but will be empty.
    const corpActionsByDate = new Map<string, { symbol: string; type: string; ratio: number }[]>();
    financeLogger.info(`Corporate actions now handled via Transaction table (Manual Mode)`);


    // 4. Pre-load prices (batched to avoid SQLite expression tree limit)
    const symbolChunks = chunkArray(symbols);
    const stockHistoryArrays = await Promise.all(
        symbolChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { symbol: { in: chunk }, date: { gte: startDate } }
            })
        )
    );
    const stockHistory = stockHistoryArrays.flat();

    // 4a. Use Symbol Mappings (loaded at start of function)
    const aliasMap = new Map<string, string[]>();
    for (const m of symbolMappings) {
        // Map Old -> New (If we have price for New, update Old)
        if (!aliasMap.has(m.newSymbol)) aliasMap.set(m.newSymbol, []);
        aliasMap.get(m.newSymbol)!.push(m.oldSymbol);

        // Map New -> Old (If we have price for Old, update New - less common but possible)
        if (!aliasMap.has(m.oldSymbol)) aliasMap.set(m.oldSymbol, []);
        aliasMap.get(m.oldSymbol)!.push(m.newSymbol);
    }

    // 4a2. Detect which symbols have ADJUSTED vs RAW price data
    // StockHistory may contain split-adjusted prices (from Upstox/Yahoo) that need unadjustment
    // We detect this by checking if there's a price drop around the split date
    const splitAdjustmentMap = new Map<string, { splitDate: Date; factor: number }[]>();

    const allSplits = transactions.filter(t =>
        (t.type === 'SPLIT' || t.type === 'BONUS') && t.splitRatio && t.splitRatio > 1
    );

    // Group corporate actions by symbol and date to handle multiple actions on same day
    // (e.g., BONUS 1:1 and SPLIT 1:2 on same day = combined 4x adjustment)
    const groupedActions = new Map<string, { splitDate: Date; combinedRatio: number; actions: string[] }>();

    for (const split of allSplits) {
        const sym = split.symbol.toUpperCase();
        const ratio = split.splitRatio || 1;
        const dateKey = `${sym}_${format(split.date, 'yyyy-MM-dd')}`;

        if (!groupedActions.has(dateKey)) {
            groupedActions.set(dateKey, { splitDate: split.date, combinedRatio: 1, actions: [] });
        }
        const group = groupedActions.get(dateKey)!;
        group.combinedRatio *= ratio;
        group.actions.push(`${split.type}(${ratio})`);
    }

    // Now process each grouped action
    for (const [key, group] of groupedActions) {
        // Extract symbol from the key (format: "SYMBOL_YYYY-MM-DD")
        const symbol = key.split('_')[0];

        const combinedRatio = group.combinedRatio;

        // Find prices around split date from stockHistory
        const pricesAroundSplit = stockHistory.filter(h =>
            h.symbol.toUpperCase() === symbol &&
            h.date >= new Date(group.splitDate.getTime() - 7 * 24 * 60 * 60 * 1000) &&
            h.date <= new Date(group.splitDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        ).sort((a, b) => a.date.getTime() - b.date.getTime());

        const preBefore = pricesAroundSplit.filter(p => p.date < group.splitDate);
        const postAfter = pricesAroundSplit.filter(p => p.date >= group.splitDate);

        let isAdjusted = true; // Default to adjusted (safer)

        if (preBefore.length > 0 && postAfter.length > 0) {
            const preSplitPrice = preBefore[preBefore.length - 1].close;
            const postSplitPrice = postAfter[0].close;
            const priceRatio = preSplitPrice / postSplitPrice;

            // If price dropped by approximately the COMBINED ratio, data is RAW
            if (Math.abs(priceRatio - combinedRatio) < 0.5) {
                isAdjusted = false;
                financeLogger.info(`[Recalc] ${symbol}: RAW data detected (price drop ${priceRatio.toFixed(2)} ≈ ${combinedRatio}) [${group.actions.join(' + ')}]`);
            } else {
                financeLogger.info(`[Recalc] ${symbol}: ADJUSTED data detected (price ratio ${priceRatio.toFixed(2)}, need to unadjust by ${combinedRatio}) [${group.actions.join(' + ')}]`);
            }
        } else if (postAfter.length === 0) {
            // No post-split prices available (split is today or in the future).
            // Upstox won't have retroactively adjusted prices for a split that hasn't happened yet,
            // so treat data as RAW — no unadjustment needed.
            isAdjusted = false;
            financeLogger.info(`[Recalc] ${symbol}: No post-split prices available (split date: ${format(group.splitDate, 'yyyy-MM-dd')}). Treating as RAW. [${group.actions.join(' + ')}]`);
        }

        if (isAdjusted) {
            // Need to unadjust prices BEFORE the split date using COMBINED ratio
            if (!splitAdjustmentMap.has(symbol)) splitAdjustmentMap.set(symbol, []);
            splitAdjustmentMap.get(symbol)!.push({ splitDate: group.splitDate, factor: combinedRatio });
        }
    }

    // Sort adjustments by date descending for each symbol
    for (const [, adjustments] of splitAdjustmentMap) {
        adjustments.sort((a, b) => b.splitDate.getTime() - a.splitDate.getTime());
    }

    const priceMap = new Map<string, Map<string, number>>();
    stockHistory.forEach((h) => {
        const dKey = h.date.toISOString().split('T')[0];
        if (!priceMap.has(dKey)) priceMap.set(dKey, new Map());

        // Apply split adjustment if needed (unadjust split-adjusted prices)
        let adjustedPrice = h.close;
        const adjustments = splitAdjustmentMap.get(h.symbol.toUpperCase());
        if (adjustments) {
            for (const adj of adjustments) {
                // If this price is BEFORE the split date, multiply by the factor
                if (h.date < adj.splitDate) {
                    adjustedPrice *= adj.factor;
                }
            }
        }

        priceMap.get(dKey)!.set(h.symbol, adjustedPrice);
    });

    const indexHistory = await prisma.indexHistory.findMany({
        where: { date: { gte: startDate } }
    });
    // Map<DateString, Map<Symbol, Close>>
    const indexMap = new Map<string, Map<string, number>>();
    indexHistory.forEach((h) => {
        const dKey = h.date.toISOString().split('T')[0];
        if (!indexMap.has(dKey)) indexMap.set(dKey, new Map());
        indexMap.get(dKey)!.set(h.symbol, h.close);
    });

    // 4b. AMFI Market Cap Classifications will be loaded dynamically in the loop below
    let amfiCategories = new Map<string, AMFICategory>();
    let lastAmfiPeriod: string | null = null;

    // 4c. Pre-load Sector Mappings (with symbol mapping support)
    const sectorMappingsList = await prisma.sectorMapping.findMany();
    const sectorMap = new Map<string, string>();
    sectorMappingsList.forEach((s: SectorMapping) => sectorMap.set(s.symbol, s.sector));

    // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
    // If we have a sector for oldSymbol but not newSymbol (or vice versa), copy it
    for (const m of symbolMappings) {
        const oldSector = sectorMap.get(m.oldSymbol);
        const newSector = sectorMap.get(m.newSymbol);

        if (oldSector && !newSector) {
            // Old symbol has sector, new doesn't - copy to new
            sectorMap.set(m.newSymbol, oldSector);
        } else if (newSector && !oldSector) {
            // New symbol has sector, old doesn't - copy to old
            sectorMap.set(m.oldSymbol, newSector);
        }
    }
    financeLogger.info(`[Recalc] Loaded ${sectorMappingsList.length} sector mappings, extended to ${sectorMap.size} with symbol mappings.`);

    // 5. Clear snapshots (PARTIALLY or FULLY)
    // Respect DATA_LOCK_DATE: only delete snapshots AFTER the lock date
    const dataLockDate = await getDataLockDate();
    const deleteFromDate = dataLockDate
        ? dateMax([effectiveFromDate, addDays(dataLockDate, 1)])
        : effectiveFromDate;

    financeLogger.info(`Clearing snapshots from ${deleteFromDate.toISOString()}...`);
    if (dataLockDate) {
        financeLogger.info(`[Data Lock] Protecting snapshots on or before ${dataLockDate.toISOString().split('T')[0]}`);
    }
    onProgress?.("Simulating Portfolio...", 30);

    await prisma.dailyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });
    await prisma.weeklyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });
    await prisma.monthlyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });

    // 6. Simulation State using PortfolioEngine

    // Shared helper for weekly/monthly snapshot stats to avoid duplication
    function computeSnapshotStats(
        large: number, mid: number, small: number, micro: number,
        wins: number, losses: number, closedTradesCount: number,
        totalWinPct: number, totalLossPct: number, totalHoldDays: number
    ) {
        const stockTotal = large + mid + small + micro;
        return {
            largePct: stockTotal > 0 ? (large / stockTotal) * 100 : 0,
            midPct: stockTotal > 0 ? (mid / stockTotal) * 100 : 0,
            smallPct: stockTotal > 0 ? (small / stockTotal) * 100 : 0,
            microPct: stockTotal > 0 ? (micro / stockTotal) * 100 : 0,
            winPercent: closedTradesCount > 0 ? (wins / closedTradesCount) * 100 : 0,
            lossPercent: closedTradesCount > 0 ? (losses / closedTradesCount) * 100 : 0,
            avgWinnerGain: wins > 0 ? (totalWinPct / wins) * 100 : 0,
            avgLoserLoss: losses > 0 ? (totalLossPct / losses) * 100 : 0,
            avgHoldingPeriod: closedTradesCount > 0 ? totalHoldDays / closedTradesCount : 0,
        };
    }
    const engine = new PortfolioEngine();

    // TWR Metrics
    let nav = 100;

    // Index tracking state — data-driven instead of per-index variables
    type IndexTracker = { lastKnown: number; startValue: number };
    const indexTrackers = new Map<string, IndexTracker>([
        ['NIFTY50', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_500', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_MIDCAP100', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_SMALLCAP250', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_MICROCAP250', { lastKnown: 0, startValue: 0 }],
    ]);

    const lastKnownPrices = new Map<string, number>();

    // Snapshot metrics state
    let maxNav = 100;
    const navHistory: number[] = [];

    // Performance Stats State (Cumulative)
    let wins = 0, losses = 0;
    let totalWinPct = 0, totalLossPct = 0;
    let totalHoldDays = 0, closedTradesCount = 0;

    // Monthly Exit Stats
    let monthExits = 0;
    let monthsActive = 0;

    let currentDate = startDate;

    // Pointers
    let tIndex = 0;

    let prevTotalEquity = 0;
    // Previous Weekly/Monthly NAVs for Return Calc
    let lastWeeklyNav = 0;
    let lastMonthlyNav = 0;



    // Batch Data Arrays with proper types
    type DailySnapshotInput = {
        date: Date;
        totalEquity: number;
        investedCapital: number;
        portfolioNAV: number;
        niftyNAV: number | null;
        nifty500Momentum50NAV: number | null;
        niftyMidcap100NAV: number | null;
        niftySmallcap250NAV: number | null;
        niftyMicrocap250NAV: number | null;
        units: number;
        cashflow: number;
        drawdown: number;
        dailyPnL: number;
        dailyReturn: number;
        navMA200: number | null;
        xirr: number | null;
        cagr: number | null;
    };

    type WeeklySnapshotInput = {
        date: Date;
        totalEquity: number;
        nav: number;
        weeklyReturn: number;
        largeCapPercent: number;
        midCapPercent: number;
        smallCapPercent: number;
        microCapPercent: number;

        marketCap: number;
        xirr: number;
        pnl: number;
        winPercent: number;
        lossPercent: number;
        avgHoldingPeriod: number;
        avgWinnerGain: number;
        avgLoserLoss: number;
        sectorAllocation: string;
    };

    type MonthlySnapshotInput = {
        date: Date;
        totalEquity: number;
        nav: number;
        monthlyReturn: number;
        largeCapPercent: number;
        midCapPercent: number;
        smallCapPercent: number;
        microCapPercent: number;
        marketCap: number;
        xirr: number;
        pnl: number;
        winPercent: number;
        lossPercent: number;
        avgHoldingPeriod: number;
        avgWinnerGain: number;
        avgLoserLoss: number;
        exitCount: number;
        avgExitsPerMonth: number;
        sectorAllocation: string;
    };

    const dailyData: DailySnapshotInput[] = [];
    const weeklyData: WeeklySnapshotInput[] = [];
    const monthlyData: MonthlySnapshotInput[] = [];

    // Incremental XIRR: build cash flow array as we go
    // BUY = negative (money out), SELL = positive (money in)
    // Each day we append that day's transaction flows, then add totalEquity as terminal flow
    const xirrFlows: { amount: number; when: Date }[] = [];
    const portfolioStartDate = startDate; // first transaction date = NAV base date

    // Prepare Loop Vars for Progress
    const totalSimDays = differenceInDays(today, currentDate);
    let daysProcessed = 0;
    const progressStart = 30; // Resume after fetching history
    const progressEnd = 90;   // Leave 10% for saving

    while (currentDate <= today) {
        // Progress Reporting (Every ~5% or at least every 30 days)
        if (totalSimDays > 0 && daysProcessed % 5 === 0) {
             const pct = daysProcessed / totalSimDays;
             const mapped = Math.floor(progressStart + (pct * (progressEnd - progressStart)));
             onProgress?.(`Simulating ${format(currentDate, 'MMM yyyy')}...`, mapped);
        }
        daysProcessed++;
        const dKey = format(currentDate, 'yyyy-MM-dd');

        // Update AMFI categories if period changes
        const amfiPeriod = getCurrentAMFIPeriod(currentDate);
        const amfiPeriodStr = `${amfiPeriod.year}_${amfiPeriod.halfYear}`;
        if (amfiPeriodStr !== lastAmfiPeriod) {
            financeLogger.info(`[Recalc] AMFI Period changed to ${amfiPeriodStr} at ${dKey}. Refreshing categories...`);
            // Pass the current date to use the appropriate AMFI period
            amfiCategories = await getAMFICategoriesBatch(symbols, currentDate);
            lastAmfiPeriod = amfiPeriodStr;
        }
        const isFriday = currentDate.getDay() === 5;
        // Check if Month End: Next day is 1st of new month OR Today is Today (last day of loop)
        const nextDay = addDays(currentDate, 1);
        const isMonthEnd = nextDay.getDate() === 1 || isSameDay(currentDate, today);
        // Also check if Today is Friday or we are at the end of loop, capture weekly
        const isWeekEnd = isFriday || isSameDay(currentDate, today);

        // A. Pricing & Market Value
        const prices = priceMap.get(dKey) || new Map();

        for (const [sym, price] of prices) {
            lastKnownPrices.set(sym, price);
            // Propagate price to aliases (e.g. if we have price for NEW, set it for OLD too)
            // IMPORTANT: Only propagate if the alias doesn't already have a price for TODAY
            // This prevents stale/wrong prices from overwriting correct ones when both
            // old and new symbols have price data (e.g., during symbol name changes)
            if (aliasMap.has(sym)) {
                for (const alias of aliasMap.get(sym)!) {
                    if (!prices.has(alias)) {
                        lastKnownPrices.set(alias, price);
                    }
                }
            }
        }

        engine.resetDailyFlow();

        // B. Process Events for Today
        let displayCashflow = 0;

        // Process Transactions
        while(tIndex < transactions.length && isSameDay(transactions[tIndex].date, currentDate)) {
            const tx = transactions[tIndex];

            // Update Prices Fallback: If StockHistory has no closing price for tx.symbol on currentDate
            // (e.g., on order days before EOD price sync), use the trade execution price (tx.price)
            // so portfolio stock valuation matches the dailyNetFlow cash flow.
            if (!prices.has(tx.symbol) && tx.price > 0) lastKnownPrices.set(tx.symbol, tx.price);

            const result = engine.processTransaction(tx);

            if (tx.type === 'BUY') {
                const tradeVal = tx.quantity * tx.price;
                displayCashflow -= tradeVal;
            } else if (tx.type === 'SELL') {
                const tradeVal = tx.quantity * tx.price;
                displayCashflow += tradeVal;
            }

            if (result) {
                // It was a SELL with realized result
                closedTradesCount++;
                monthExits++;
                totalHoldDays += result.holdDays;

                if (result.pnl > 0) {
                    wins++;
                    totalWinPct += result.returnPct;
                } else {
                    losses++;
                    totalLossPct += result.returnPct;
                }
            }

            tIndex++;
        }



        // B2. Apply Corporate Actions from Yahoo (auto-detected splits)
        const todaysCorpActions = corpActionsByDate.get(dKey) || [];
        for (const action of todaysCorpActions) {
           // My engine has applySplit(symbol, ratio). Let's use that.
           if (action.type === 'SPLIT') {
                engine.applySplit(action.symbol, action.ratio);

                // NOTE: DO NOT adjust price here.
                // Yahoo Finance prices in stockHistory are already split-adjusted.
                // halving the price again here causes the double-adjustment bug.

                financeLogger.info(`Applied SPLIT for ${action.symbol} via Engine (Price already adjusted in History)`);
           }
        }

        // C. Calculate End-of-Day Equity
        let large = 0, mid = 0, small = 0, micro = 0;

        const valuation = engine.getValuation(lastKnownPrices);

        // Use AMFI classifications for market cap segmentation
        for (const h of valuation.holdings) {
            const val = h.currentValue;

            // Get AMFI category for this symbol
            const amfiCategory = amfiCategories.get(h.symbol) || 'Small';
            const category = mapAMFIToMarketCapCategory(amfiCategory);

            switch (category) {
                case 'Large': large += val; break;
                case 'Mid': mid += val; break;
                case 'Small': small += val; break;
                case 'Micro': micro += val; break;
            }
        }

        const totalEquity = valuation.totalEquity;
        const dailyNetFlow = engine.dailyNetFlow;
        const accumulatedInvestedCapital = engine.investedCapital;

        // D. NAV Calculation
        if (prevTotalEquity === 0) {
            if (dailyNetFlow > 0) {
                // First Day: Treat flow as start-of-day capital.
                // Growth = End / Start(Flow).
                const dailyReturn = (totalEquity - dailyNetFlow) / dailyNetFlow;
                // Actually if we treat Flow as Start:
                // End = 105. Start = 100. Return = (105-100)/100 = 0.05.
                // Formula: (TotalEquity - Flow) / Flow ?
                // 105 - 100 = 5. 5/100 = 0.05. Correct.
                nav = 100 * (1 + dailyReturn);
            } else {
                nav = 100;
            }
        } else {
            const adjustedEndValue = totalEquity - dailyNetFlow;
            const dailyReturn = adjustedEndValue / prevTotalEquity;
            nav = nav * dailyReturn;
            if (Number.isNaN(nav)) nav = 100;
        }

        // Track stats
        if (nav > maxNav) maxNav = nav;
        const drawdown = maxNav > 0 ? (nav / maxNav) - 1 : 0;

        let dailyPnL = 0;
        let dailyRet = 0;

        if (prevTotalEquity > 0) {
             dailyPnL = totalEquity - dailyNetFlow - prevTotalEquity;
             // TWR Return
             dailyRet = (totalEquity - dailyNetFlow) / prevTotalEquity - 1;
        } else if (dailyNetFlow > 0) {
             // First Day / Restart
             dailyPnL = totalEquity - dailyNetFlow;
             dailyRet = (totalEquity - dailyNetFlow) / dailyNetFlow;
        }

        navHistory.push(nav);
        let navMA200 = 0;
        if (navHistory.length >= NAV_MA_WINDOW) {
             const slice = navHistory.slice(-NAV_MA_WINDOW);
             const sum = slice.reduce((a, b) => a + b, 0);
             navMA200 = sum / NAV_MA_WINDOW;
        }

        // E. Index NAV Comparison (data-driven loop)
        const indexPrices = indexMap.get(dKey);
        const indexNavs = new Map<string, number>();

        for (const [key, tracker] of indexTrackers) {
            const val = indexPrices?.get(key);
            let indexNav = 0;
            if (val) {
                if (tracker.startValue === 0) tracker.startValue = val;
                tracker.lastKnown = val;
                indexNav = (val / tracker.startValue) * 100;
            } else if (tracker.lastKnown > 0 && tracker.startValue > 0) {
                indexNav = (tracker.lastKnown / tracker.startValue) * 100;
            }
            indexNavs.set(key, indexNav);
        }



        const units = nav > 0 ? totalEquity / nav : 0;
        const pnl = totalEquity - accumulatedInvestedCapital;

        // F1. Append today's transaction cash flows for incremental XIRR
        // This mirrors the flow-building in calculatePortfolioXIRR (holdings.ts)
        // We track the loop's tIndex position; transactions already consumed above in section B.
        // So we re-derive flows from displayCashflow for simplicity:
        // BUY reduces cash (negative), SELL adds cash (positive)
        if (Math.abs(displayCashflow) > 0) {
            xirrFlows.push({ amount: displayCashflow, when: new Date(currentDate) });
        }

        // F2. Compute XIRR and CAGR for this day
        let dailyXirr: number | null = null;
        let dailyCagr: number | null = null;

        if (totalEquity > 0 && xirrFlows.length > 0) {
            try {
                const flowsWithTerminal = [
                    ...xirrFlows,
                    { amount: totalEquity, when: new Date(currentDate) }
                ];
                const rate = xirr(flowsWithTerminal);
                dailyXirr = roundPercent(rate); // stored as decimal e.g. 0.2354
            } catch {
                // xirr() throws when it cannot converge — leave null
                dailyXirr = null;
            }
        }

        const daysElapsed = differenceInDays(currentDate, portfolioStartDate);
        if (daysElapsed > 0 && nav > 0) {
            dailyCagr = roundPercent(Math.pow(nav / 100, 365 / daysElapsed) - 1);
        }

        // F. Save Daily Snapshot IF within recalculation window AND it's a trading day
        // Skip weekends and market holidays - no snapshot for non-trading days
        // Special sessions (Budget Day, Muhurat) are detected via the specialTradingDays API set
        if (currentDate >= effectiveFromDate && isTradingDay(currentDate)) {
            const d = new Date(currentDate);
            const utcSnapshotDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

            dailyData.push({
                date: utcSnapshotDate,
                totalEquity: roundEquity(totalEquity),
                investedCapital: roundEquity(accumulatedInvestedCapital),
                portfolioNAV: roundPrice(nav),
                niftyNAV: indexNavs.get('NIFTY50') ? roundPrice(indexNavs.get('NIFTY50')!) : null,
                nifty500Momentum50NAV: indexNavs.get('NIFTY_500') ? roundPrice(indexNavs.get('NIFTY_500')!) : null,
                niftyMidcap100NAV: indexNavs.get('NIFTY_MIDCAP100') ? roundPrice(indexNavs.get('NIFTY_MIDCAP100')!) : null,
                niftySmallcap250NAV: indexNavs.get('NIFTY_SMALLCAP250') ? roundPrice(indexNavs.get('NIFTY_SMALLCAP250')!) : null,
                niftyMicrocap250NAV: indexNavs.get('NIFTY_MICROCAP250') ? roundPrice(indexNavs.get('NIFTY_MICROCAP250')!) : null,
                units: roundQuantity(units),
                cashflow: roundEquity(displayCashflow),
                drawdown: roundPercent(drawdown),
                dailyPnL: roundEquity(dailyPnL),
                dailyReturn: roundPercent(dailyRet),
                navMA200: navMA200 ? roundPrice(navMA200) : null,
                xirr: currentDate >= SNAPSHOT_START_DATE ? dailyXirr : null,
                cagr: currentDate >= SNAPSHOT_START_DATE ? dailyCagr : null,
            });
        }


        // Calculate Sector Allocation for weekly/monthly snapshots
        let currentSectorAllocations: SectorAllocation[] = [];
        if (isWeekEnd || isMonthEnd) {
            const sectorAllocMap = new Map<string, { value: number, count: number }>();
            let totalSectorValue = 0;

            engine.holdings.forEach((h, sym) => {
                if (h.qty <= 0.001) return;
                const price = lastKnownPrices.get(sym) || 0;
                if (price <= 0) return;

                const val = h.qty * price;
                const sector = sectorMap.get(sym) || 'Unknown';

                const existing = sectorAllocMap.get(sector) || { value: 0, count: 0 };
                existing.value += val;
                existing.count += 1;
                sectorAllocMap.set(sector, existing);
                totalSectorValue += val;
            });

            currentSectorAllocations = Array.from(sectorAllocMap.entries()).map(([sector, data]) => ({
                sector,
                value: data.value,
                count: data.count,
                allocation: totalSectorValue > 0 ? (data.value / totalSectorValue) * 100 : 0,
                dayChangePercent: 0
            })).sort((a, b) => b.value - a.value);
        }

        // G. Weekly Snapshot
        if (isWeekEnd) {
             // Calculate Weekly Return
             let weeklyReturn = 0;
             const prevNav = lastWeeklyNav > 0 ? lastWeeklyNav : 100;
             weeklyReturn = (nav / prevNav) - 1;

             // Shared stats for weekly/monthly snapshots
             const stats = computeSnapshotStats(large, mid, small, micro, wins, losses, closedTradesCount, totalWinPct, totalLossPct, totalHoldDays);

             /**
              * XIRR LIMITATION:
              * XIRR is computationally expensive as it requires iterating over ALL cash flows
              * from the portfolio start date up to the current snapshot date. Computing XIRR
              * for every daily/weekly/monthly snapshot in a loop would cause:
              * - O(n * m) complexity where n = days and m = cash flows
              * - Potential timeouts for portfolios with 1000+ days of history
              *
              * WORKAROUND:
              * - XIRR is calculated on-demand via `calculatePortfolioXIRR()` in the dashboard stats
              * - Weekly/Monthly snapshot capture functions calculate XIRR individually
              * - The recalculation loop sets XIRR to 0 as a placeholder
              *
              * For accurate XIRR in snapshots, use the individual capture functions or
              * implement incremental XIRR calculation that reuses previous computations.
              */
             const xirrVal = 0;

             if (currentDate >= effectiveFromDate) {
                 weeklyData.push({
                     date: currentDate,
                     totalEquity: roundEquity(totalEquity),
                     nav: roundPrice(nav),
                     weeklyReturn: roundPercent(weeklyReturn),
                     largeCapPercent: roundPercent(stats.largePct),
                     midCapPercent: roundPercent(stats.midPct),
                     smallCapPercent: roundPercent(stats.smallPct),
                     microCapPercent: roundPercent(stats.microPct),

                     marketCap: 0,
                     xirr: roundPercent(xirrVal),
                     pnl: roundEquity(pnl),
                     winPercent: roundPercent(stats.winPercent),
                     lossPercent: roundPercent(stats.lossPercent),
                     avgHoldingPeriod: Math.round(stats.avgHoldingPeriod * 10) / 10,
                     avgWinnerGain: roundPercent(stats.avgWinnerGain),
                     avgLoserLoss: roundPercent(stats.avgLoserLoss),
                     sectorAllocation: JSON.stringify(currentSectorAllocations)
                 });
             }

             lastWeeklyNav = nav;
        }


        // H. Monthly Snapshot
        if (isMonthEnd) {
             let monthlyReturn = 0;
             const prevNav = lastMonthlyNav > 0 ? lastMonthlyNav : 100;
             monthlyReturn = (nav / prevNav) - 1;

             const stats = computeSnapshotStats(large, mid, small, micro, wins, losses, closedTradesCount, totalWinPct, totalLossPct, totalHoldDays);

             // Exit Stats
             // const avgExitsPerMonth = monthsActive > 0 ? closedTradesCount / (monthsActive + 1) : closedTradesCount;
             // Note: using (monthsActive + 1) because current month is just finishing but monthsActive increments after.
             // Actually, let's execute increment at end of block. So dividing by (monthsActive + 1) is correct for "current month index + 1".
             // Or better: increment monthsActive AFTER using it?
             // Let's increment monthsActive at end of block. So logic:
             // 1st month: monthsActive=0. Div by 1.
             // 2nd month: monthsActive=1. Div by 2.
             const currentMonthsCount = monthsActive + 1;
             const calculatedAvgExits = closedTradesCount / currentMonthsCount;

             const xirrVal = 0;

             if (currentDate >= effectiveFromDate) {
                 monthlyData.push({
                     date: currentDate,
                     totalEquity: roundEquity(totalEquity),
                     nav: roundPrice(nav),
                     monthlyReturn: roundPercent(monthlyReturn),
                     largeCapPercent: roundPercent(stats.largePct),
                     midCapPercent: roundPercent(stats.midPct),
                     smallCapPercent: roundPercent(stats.smallPct),
                     microCapPercent: roundPercent(stats.microPct),
                     marketCap: 0,
                     xirr: roundPercent(xirrVal),
                     pnl: roundEquity(pnl),
                     winPercent: roundPercent(stats.winPercent),
                     lossPercent: roundPercent(stats.lossPercent),
                     avgHoldingPeriod: Math.round(stats.avgHoldingPeriod * 10) / 10,
                     avgWinnerGain: roundPercent(stats.avgWinnerGain),
                     avgLoserLoss: roundPercent(stats.avgLoserLoss),
                     exitCount: monthExits,
                     avgExitsPerMonth: Math.round(calculatedAvgExits * 10) / 10,
                     sectorAllocation: JSON.stringify(currentSectorAllocations)
                 });
             }

             lastMonthlyNav = nav;

             // Reset Monthly Stats
             monthExits = 0;
             monthsActive++;
        }

        // Prep for next day
        prevTotalEquity = totalEquity;
        currentDate = addDays(currentDate, 1);
    }



    // Batch Insert Implementation
    // Filter out snapshots on or before dataLockDate (protected data)
    const filterLocked = <T extends { date: Date }>(data: T[]): T[] => {
        if (!dataLockDate) return data;
        return data.filter(d => d.date > dataLockDate!);
    };

    const filteredDaily = filterLocked(dailyData);
    const filteredWeekly = filterLocked(weeklyData);
    // Deduplicate monthly snapshots by year-month, keeping only the latest entry per month
    // This prevents duplicates when locked data protects an older entry in the same month
    const monthlyDeduped = new Map<string, typeof monthlyData[0]>();
    for (const entry of monthlyData) {
        const key = `${entry.date.getFullYear()}-${entry.date.getMonth()}`;
        monthlyDeduped.set(key, entry); // Later entries (closer to today) overwrite earlier ones
    }
    const filteredMonthly = filterLocked(Array.from(monthlyDeduped.values()));

    if (filteredDaily.length > 0) {
        financeLogger.info(`Bulk Inserting ${filteredDaily.length} daily snapshots...`);
        await prisma.dailyPortfolioSnapshot.createMany({ data: filteredDaily });
    }
    if (filteredWeekly.length > 0) {
        financeLogger.info(`Bulk Inserting ${filteredWeekly.length} weekly snapshots...`);
        await prisma.weeklyPortfolioSnapshot.createMany({ data: filteredWeekly });
    }
    if (filteredMonthly.length > 0) {
        financeLogger.info(`Bulk Inserting ${filteredMonthly.length} monthly snapshots...`);
        onProgress?.("Saving snapshots...", 90);
        // Clear any existing monthly snapshots in the date range we're inserting
        // This handles entries created by captureMonthlySnapshot() on different dates in the same month
        const minMonthlyDate = filteredMonthly.reduce((min, e) => e.date < min ? e.date : min, filteredMonthly[0].date);
        const startOfMinMonth = new Date(Date.UTC(minMonthlyDate.getUTCFullYear(), minMonthlyDate.getUTCMonth(), 1));
        await prisma.monthlyPortfolioSnapshot.deleteMany({
            where: { date: { gte: startOfMinMonth } }
        });
        await prisma.monthlyPortfolioSnapshot.createMany({ data: filteredMonthly });
    }

    financeLogger.info("Recalculation Complete.");
    try {
        // Invalidate caches - using 'as any' to bypass potential signature mismatch in tooling
         
        (revalidateTag as any)('portfolio-data');
         
        (revalidateTag as any)('dashboard-stats');
    } catch (e) {
        financeLogger.warn("revalidateTag failed (expected when run outside Next.js server context):", e);
    }
}

// updateJob, failJob, completeJob are imported at the top of the file

export async function recalculatePortfolioHistory(
    fromDate?: Date,
    onProgress?: ProgressCallback,
    jobId?: string,
    options?: { forceNSE?: boolean; forceSymbol?: string }
) {
    try {
        await recalculatePortfolioHistoryInternal(fromDate, async (msg, progress) => {
             if (jobId) {
                 await updateJob(jobId, progress, msg).catch(e => financeLogger.error("Job Update Failed:", e));
             }
             onProgress?.(msg, progress);
        }, options);

        if (jobId) {
            await completeJob(jobId, { success: true });
        }
    } catch (error) {
        financeLogger.error("Critical Error in Portfolio Recalculation:", error);
        if (jobId) {
             await failJob(jobId, error);
        }
        throw error;
    }
}
