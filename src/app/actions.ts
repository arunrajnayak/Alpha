'use server';

import { prisma, chunkArray } from '@/lib/db';
import { createBackup } from '@/lib/backup';
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { recalculatePortfolioHistory } from '@/lib/finance';
import { getLTP, hasValidToken } from '@/lib/upstox-client';
import { getInstrumentKeys, isValidSymbol, getInstrumentKeyByISIN, getSymbolFromKey } from '@/lib/instrument-service';
import { getSymbolResolver } from '@/lib/amfi-service';
import { fetchNSEHistory } from '@/lib/nse-api';

export interface SymbolValidationResult {
  symbol: string;
  isValid: boolean;
  currentPrice?: number;
  error?: string;
  originalSymbol?: string;
  resolvedSymbol?: string;
}

export async function validateSymbols(inputs: (string | { symbol: string, isin?: string })[]): Promise<SymbolValidationResult[]> {
  const results: SymbolValidationResult[] = [];
  
  // Normalize inputs to objects
  const uniqueInputs = new Map<string, { symbol: string, isin?: string }>();
  
  for (const input of inputs) {
    const symbol = typeof input === 'string' ? input : input.symbol;
    const isin = typeof input === 'string' ? undefined : input.isin;
    
    // Prefer input with ISIN if duplicate symbols exist
    if (!uniqueInputs.has(symbol) || (isin && !uniqueInputs.get(symbol)?.isin)) {
        uniqueInputs.set(symbol, { symbol, isin });
    }
  }

  const uniqueSymbols = Array.from(uniqueInputs.keys());

  // Check if we have a valid Upstox token for live prices
  const hasToken = await hasValidToken();
  
  if (hasToken) {
    try {
      // Get instrument keys for all symbols
      const keyMap = await getInstrumentKeys(uniqueSymbols);
      const keysToFetch: string[] = [];
      const symbolsWithKeys: string[] = [];

      for (const [symbol, key] of keyMap.entries()) {
          keysToFetch.push(key);
          symbolsWithKeys.push(symbol);
      }
      
      const ltpMap = keysToFetch.length > 0 ? await getLTP(keysToFetch) : new Map();

      // Process results
      for (const input of uniqueInputs.values()) {
        const { symbol, isin } = input;
        const key = keyMap.get(symbol);
        
        if (key) {
          const price = ltpMap.get(key);
          if (price !== undefined) {
            results.push({
              symbol,
              isValid: true,
              currentPrice: price
            });
          } else {
            // Key found but no price
            results.push({ symbol, isValid: true, error: 'No live price available' });
          }
        } else {
            // Symbol not found - Try ISIN Fallback
            let resolved = false;
            
            if (isin) {
                try {
                    const instrumentKey = await getInstrumentKeyByISIN(isin);
                    if (instrumentKey) {
                        const newSymbol = await getSymbolFromKey(instrumentKey);
                        if (newSymbol) {
                            // Fetch price for new symbol to confirm it works
                            const newPriceMap = await getLTP([instrumentKey]);
                            const newPrice = newPriceMap.get(instrumentKey);
                            
                            results.push({
                                symbol: newSymbol, // Return the NEW symbol as the valid one
                                originalSymbol: symbol,
                                resolvedSymbol: newSymbol,
                                isValid: true,
                                currentPrice: newPrice,
                                error: 'Resolved via ISIN'
                            });
                            resolved = true;
                        }
                    }
                } catch (err) {
                    console.warn(`[validateSymbols] ISIN lookup failed for ${symbol} (${isin}):`, err);
                }
            }

            if (!resolved) {
                // Try NSE as final fallback (for delisted stocks)
                try {
                    const twoYearsAgo = new Date();
                    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                    const nseData = await fetchNSEHistory(symbol, twoYearsAgo, new Date());
                    if (nseData && nseData.data && nseData.data.length > 0) {
                        // NSE has historical data - symbol is valid (likely delisted)
                        const sortedData = nseData.data.sort((a, b) => 
                            new Date(b.CH_TIMESTAMP).getTime() - new Date(a.CH_TIMESTAMP).getTime()
                        );
                        const lastPrice = sortedData[0].CH_CLOSING_PRICE;
                        const lastDate = sortedData[0].CH_TIMESTAMP;
                        results.push({
                            symbol,
                            isValid: true,
                            currentPrice: lastPrice,
                            error: `Delisted (last: ${lastDate})`
                        });
                        resolved = true;
                    }
                } catch (nseErr) {
                    console.warn(`[validateSymbols] NSE fallback failed for ${symbol}:`, nseErr);
                }
            }
            
            if (!resolved) {
                results.push({ symbol, isValid: false, error: 'Symbol not found in exchange' });
            }
        }
      }
      
      return results;
    } catch (error) {
      console.warn('[validateSymbols] Upstox validation failed:', error);
    }
  }

  // Fallback: Validate using instrument master (no live prices)
  for (const input of uniqueInputs.values()) {
    const { symbol, isin } = input;
    
    // Skip if already validated (successfully or not)
    if (results.some(r => r.symbol === symbol || r.originalSymbol === symbol)) continue;
    
    try {
      const valid = await isValidSymbol(symbol);
      if (valid) {
        results.push({
          symbol,
          isValid: true,
          error: 'No live price (token unavailable)'
        });
      } else {
         // Try ISIN Fallback (Offline/Master based)
         let resolved = false;
         
         if (isin) {
             const instrumentKey = await getInstrumentKeyByISIN(isin);
             if (instrumentKey) {
                 const newSymbol = await getSymbolFromKey(instrumentKey);
                 if (newSymbol) {
                     results.push({
                         symbol: newSymbol,
                         originalSymbol: symbol,
                         resolvedSymbol: newSymbol,
                         isValid: true,
                         error: 'Resolved via ISIN (No Token)'
                     });
                     resolved = true;
                 }
             }
         }
         
         if (!resolved) {
            // Try NSE as final fallback (for delisted stocks)
            // Check last 2 years since delisted stocks won't have recent data
            try {
                const twoYearsAgo = new Date();
                twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
                const nseData = await fetchNSEHistory(symbol, twoYearsAgo, new Date());
                if (nseData && nseData.data && nseData.data.length > 0) {
                    // NSE has historical data - symbol is valid (likely delisted)
                    // Sort by date to get the most recent price
                    const sortedData = nseData.data.sort((a, b) => 
                        new Date(b.CH_TIMESTAMP).getTime() - new Date(a.CH_TIMESTAMP).getTime()
                    );
                    const lastPrice = sortedData[0].CH_CLOSING_PRICE;
                    const lastDate = sortedData[0].CH_TIMESTAMP;
                    results.push({
                        symbol,
                        isValid: true,
                        currentPrice: lastPrice,
                        error: `Delisted (last: ${lastDate})`
                    });
                    resolved = true;
                }
            } catch (nseErr) {
                console.warn(`[validateSymbols] NSE fallback failed for ${symbol}:`, nseErr);
            }
         }
         
         if (!resolved) {
            results.push({ symbol, isValid: false, error: 'Symbol not found' });
         }
      }
    } catch (error) {
           console.error(`[validateSymbols] Fallback failed for ${symbol}:`, error);
           results.push({ symbol, isValid: false, error: 'Validation failed' });
    }
  }
  return results;
}

// Job Management
import { createJob, getJob, updateJob, completeJob, failJob } from '@/lib/jobs';

export async function initializeJob(type: string): Promise<string> {
    const job = await createJob(type);
    return job.id;
}

export async function getJobStatus(id: string) {
    return await getJob(id);
}

// Import type for local usage, do not re-export to avoid build issues
import { processZerodhaTradesCore, ingestZerodhaTradesWithProgress, type ZerodhaTrade } from '@/lib/import-service';

export async function processZerodhaTrades(
    records: ZerodhaTrade[], 
    filename: string = 'import.csv',
    jobId?: string,
    mappings?: Record<string, string>
) {
    // Progress Callback
    const onProgress = async (msg: string, progress: number) => {
        if (jobId) {
            await updateJob(jobId, progress, msg).catch(console.error);
        }
    };

    try {
        const result = await processZerodhaTradesCore(records, filename, onProgress, mappings);
        
        if (jobId) {
            await completeJob(jobId, { ...result, success: true });
        }
        
        return result;
    } catch (error) {
         if (jobId) await failJob(jobId, error);
         throw error;
    } finally {
        revalidateApp();
    }
}

export async function processZerodhaUpload(
    formData: FormData,
    jobId?: string
) {
     const onProgress = async (msg: string, progress: number) => {
        if (jobId) {
            await updateJob(jobId, progress, msg).catch(console.error);
        }
    };

    try {
        const result = await ingestZerodhaTradesWithProgress(formData, onProgress);
        
        if (jobId) {
            await completeJob(jobId, { ...result, success: true });
        }
        
        return result;
    } catch (error) {
         if (jobId) await failJob(jobId, error);
         throw error;
    } finally {
        revalidateApp();
    }
}

export async function triggerRecalculatePortfolio(jobId?: string) {
    // Just a wrapper to be called from UI
    // Note: Do NOT manually delete snapshots here. 
    // recalculatePortfolioHistory handles deletion respecting DATA_LOCK_DATE.
    await recalculatePortfolioHistory(undefined, undefined, jobId);
    revalidateApp();
}

export async function revalidateApp() {
  // Revalidate all pages
  revalidatePath('/');
  revalidatePath('/trades');
  revalidatePath('/portfolio');
  revalidatePath('/snapshots');
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  
  // Revalidate cache tags (Next.js 16 requires cache profile as 2nd arg)
  revalidateTag('portfolio-data', 'max');
  revalidateTag('dashboard-stats', 'max');
  revalidateTag('holdings', 'max');
  revalidateTag('snapshots', 'max');
  revalidateTag('transactions', 'max');
}



type TransactionData = {
  date: Date;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
};

export async function addTransaction(data: TransactionData) {
    await prisma.transaction.create({
        data: {
            date: data.date,
            symbol: data.symbol,
            type: data.type,
            quantity: data.quantity,
            price: data.price,
            orderId: `MANUAL-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        }
    });
    
    await recalculatePortfolioHistory(data.date);
    revalidateApp();
}

export async function updateTransaction(id: number, data: TransactionData) {
    // Fetch old date BEFORE updating so we can do a targeted recalc
    const old = await prisma.transaction.findUnique({
        where: { id },
        select: { date: true }
    });

    await prisma.transaction.update({
        where: { id },
        data: {
            date: data.date,
            symbol: data.symbol,
            type: data.type,
            quantity: data.quantity,
            price: data.price
        }
    });

    // Recalculate from the earlier of old/new dates for efficiency
    const fromDate = old ? (old.date < data.date ? old.date : data.date) : undefined;
    await recalculatePortfolioHistory(fromDate);
    revalidateApp();
}

export async function deleteTransaction(id: number) {
    // Fetch the transaction first to know the date
    const tx = await prisma.transaction.findUnique({
        where: { id },
        select: { date: true }
    });
    
    if (!tx) {
        throw new Error(`Transaction with id ${id} not found. It may have already been deleted.`);
    }
    
    // Delete and recalculate atomically — delete first since recalc reads from DB
    await prisma.transaction.delete({
        where: { id }
    });

    // Recalculate from the deleted transaction's date
    await recalculatePortfolioHistory(tx.date);
    revalidateApp();
}

type CorporateActionData = {
  date: string | Date;
  symbol: string;
  type: string;
  ratio?: string;
  newSymbol?: string;
  description?: string;
};

export async function addCorporateAction(data: CorporateActionData) {
    await prisma.transaction.create({
        data: {
            date: new Date(data.date),
            symbol: data.symbol,
            type: data.type.toUpperCase(), // SPLIT, BONUS, SYMBOL_CHANGE
            quantity: 0, 
            price: 0,
            splitRatio: data.ratio ? parseFloat(data.ratio) : null,
            newSymbol: data.newSymbol || null,
            description: data.description,
            orderId: `CORP-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        }
    });

    await recalculatePortfolioHistory(new Date(data.date));
    revalidateApp();
}






export async function getUniqueSymbols(): Promise<string[]> {
    const symbols = await prisma.transaction.findMany({
        select: { symbol: true },
        distinct: ['symbol']
    });
    return symbols.map(s => s.symbol).sort();
}



// --- Import Management ---

export async function getImportHistory() {
  return await prisma.importBatch.findMany({
    orderBy: { timestamp: 'desc' }
  });
}

export async function revertImport(batchId: number) {
  // Create backup before reverting
  const backup = await createBackup(`pre_revert_batch_${batchId}`);
  if (!backup.success) {
      throw new Error("Safeguard: Backup failed. Aborting revert to prevent data loss.");
  }

  // Delete transactions first
  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({
        where: { importBatchId: batchId }
    });

    // Delete batch record
    await tx.importBatch.delete({
        where: { id: batchId }
    });
  });

  await recalculatePortfolioHistory();
  revalidateApp();
}

export async function clearAllTransactions() {
  // Create strict backup
  const backup = await createBackup('pre_clear_all');
  if (!backup.success) {
      throw new Error("Safeguard: Backup failed. Aborting clear all to prevent data loss.");
  }

  await prisma.$transaction(async (tx) => {
      // 1. Delete Foreign Key Dependents first (Transactions)
      await tx.transaction.deleteMany({});
      
      // 2. Delete Primary Data
      await tx.importBatch.deleteMany({});
      // Note: Cashflow table was removed from schema - cashflow is now tracked as a field in DailyPortfolioSnapshot
      
      // 3. Delete Derived Data (Snapshots & History)
      await tx.dailyPortfolioSnapshot.deleteMany({});
      await tx.weeklyPortfolioSnapshot.deleteMany({});
      await tx.monthlyPortfolioSnapshot.deleteMany({});
      
      // Optional: Clear Stock History? 
      // User might want to keep price history cache. 
      // Typically "Clear All Data" implies "My Portfolio Data", not "System Cache".
      // We will KEEP StockHistory/IndexHistory/MarketCapDefinition/SymbolMapping as they are configuration/system data.
  });
  
  
  revalidateApp();
}

export interface HistoricalHolding {
    symbol: string;
    quantity: number;
    price: number;
    currentValue: number;
    invested: number;
    pnl: number;
    pnlPercent: number;
}

import { computePortfolioState } from '@/lib/finance';

async function getSnapshotHoldingsInternal(dateStr: string): Promise<HistoricalHolding[]> {
    const targetDate = new Date(dateStr);
    targetDate.setHours(23, 59, 59, 999);

    const engine = await computePortfolioState(targetDate);

    // Get Prices
    const symbols = Array.from(engine.holdings.keys()).filter(s => {
        const d = engine.holdings.get(s);
        return d && d.qty >= 0.01;
    });

    const priceMap = new Map<string, number>();
    
    if (symbols.length > 0) {
        // Load symbol mappings only for relevant symbols (batched to avoid SQLite expression tree limit)
        const symbolChunks = chunkArray(symbols);
        const symbolMappingsArrays = await Promise.all(
            symbolChunks.map(chunk =>
                prisma.symbolMapping.findMany({
                    where: {
                        OR: [
                            { oldSymbol: { in: chunk } },
                            { newSymbol: { in: chunk } }
                        ]
                    }
                })
            )
        );
        const symbolMappings = symbolMappingsArrays.flat();
        const oldToNewMap = new Map<string, string>();
        const newToOldMap = new Map<string, string>();
        
        for (const m of symbolMappings) {
            oldToNewMap.set(m.oldSymbol, m.newSymbol);
            newToOldMap.set(m.newSymbol, m.oldSymbol);
        }

        const allSymbolsToFetch = new Set<string>(symbols);
        for (const symbol of symbols) {
            if (oldToNewMap.has(symbol)) allSymbolsToFetch.add(oldToNewMap.get(symbol)!);
            if (newToOldMap.has(symbol)) allSymbolsToFetch.add(newToOldMap.get(symbol)!);
        }

        // Get all SPLIT/BONUS actions AFTER targetDate to potentially unadjust prices
        // StockHistory may contain split-adjusted prices (from Upstox/Yahoo), so we need to
        // detect and multiply by the split factor to get the actual price at that historical date
        const futureSplits = await prisma.transaction.findMany({
            where: {
                type: { in: ['SPLIT', 'BONUS'] },
                date: { gt: targetDate },
                splitRatio: { not: null }
            },
            select: { symbol: true, splitRatio: true, date: true }
        });
        
        // For each symbol with future splits, check if StockHistory data is adjusted or raw
        // by looking for a price drop around the split date
        const splitFactorMap = new Map<string, number>();
        
        for (const split of futureSplits) {
            const sym = split.symbol.toUpperCase();
            const ratio = split.splitRatio || 1;
            
            // Check prices around split date to detect if data is raw or adjusted
            const pricesAroundSplit = await prisma.stockHistory.findMany({
                where: {
                    symbol: sym,
                    date: {
                        gte: new Date(split.date.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days before
                        lte: new Date(split.date.getTime() + 7 * 24 * 60 * 60 * 1000)  // 7 days after
                    }
                },
                orderBy: { date: 'asc' }
            });
            
            // Find prices just before and after split date
            const preBefore = pricesAroundSplit.filter(p => p.date < split.date);
            const postAfter = pricesAroundSplit.filter(p => p.date >= split.date);
            
            if (preBefore.length > 0 && postAfter.length > 0) {
                const preSplitPrice = preBefore[preBefore.length - 1].close;
                const postSplitPrice = postAfter[0].close;
                const priceRatio = preSplitPrice / postSplitPrice;
                
                // If price dropped by approximately the split ratio, data is RAW (not adjusted)
                // In this case, we don't need to unadjust
                if (Math.abs(priceRatio - ratio) < 0.5) {
                    // Data is RAW - no adjustment needed for this symbol
                    console.log(`[Holdings] ${sym}: RAW data detected (price drop ${priceRatio.toFixed(2)} ~ ratio ${ratio})`);
                    continue;
                }
            }
            
            // Data is ADJUSTED - need to unadjust by multiplying by split factor
            const currentFactor = splitFactorMap.get(sym) || 1;
            splitFactorMap.set(sym, currentFactor * ratio);
        }

        // Optimized: Use groupBy to get max date per symbol, then fetch only those records (batched)
        const symbolArray = Array.from(allSymbolsToFetch);
        const fetchChunks = chunkArray(symbolArray);
        const latestDatesArrays = await Promise.all(
            fetchChunks.map(chunk =>
                prisma.stockHistory.groupBy({
                    by: ['symbol'],
                    where: {
                        symbol: { in: chunk },
                        date: { lte: targetDate }
                    },
                    _max: { date: true }
                })
            )
        );
        const latestDates = latestDatesArrays.flat();

        // Fetch only the latest price record for each symbol
        const latestPriceConditions = latestDates
            .filter(ld => ld._max.date !== null)
            .map(ld => ({
                symbol: ld.symbol,
                date: ld._max.date!
            }));

        const rawPriceMap = new Map<string, number>();
        
        if (latestPriceConditions.length > 0) {
            // Batch the OR conditions to avoid SQLite expression tree limit
            const orChunks = chunkArray(latestPriceConditions);
            const latestPricesArrays = await Promise.all(
                orChunks.map(chunk =>
                    prisma.stockHistory.findMany({
                        where: { OR: chunk },
                        select: { symbol: true, close: true }
                    })
                )
            );
            const latestPrices = latestPricesArrays.flat();

            for (const record of latestPrices) {
                // Unadjust the price by multiplying by future split factor
                // This converts split-adjusted prices back to actual historical prices
                const splitFactor = splitFactorMap.get(record.symbol.toUpperCase()) || 1;
                rawPriceMap.set(record.symbol, record.close * splitFactor);
            }
        }

        // Fill final price map with mapping logic
        for (const symbol of symbols) {
            let price = rawPriceMap.get(symbol);
            if (price === undefined && oldToNewMap.has(symbol)) price = rawPriceMap.get(oldToNewMap.get(symbol)!);
            if (price === undefined && newToOldMap.has(symbol)) price = rawPriceMap.get(newToOldMap.get(symbol)!);
            
            if (price !== undefined) {
                priceMap.set(symbol, price);
            }
        }
    }

    const valuation = engine.getValuation(priceMap);
    
    // Convert to HistoricalHolding[]
    const result: HistoricalHolding[] = valuation.holdings.map(h => ({
        symbol: h.symbol,
        quantity: h.qty,
        price: h.price,
        currentValue: h.currentValue,
        invested: h.invested,
        pnl: h.pnl,
        pnlPercent: h.pnlPercent * 100, // Convert to %
    }));

    return result.sort((a, b) => b.currentValue - a.currentValue);
}

// Cache wrapper for getSnapshotHoldings - caches by date string for 1 hour
export const getSnapshotHoldings = unstable_cache(
    getSnapshotHoldingsInternal,
    ['snapshot-holdings'],
    { tags: ['portfolio-data'], revalidate: 3600 }
);

export interface CorporateAction {
    id: number;
    date: Date;
    symbol: string;
    type: string;
    ratio: number;
    source: string;
}

export async function getCorporateActions(): Promise<CorporateAction[]> {
    const actions = await prisma.transaction.findMany({
        where: {
            type: { in: ['SPLIT', 'BONUS'] }
        },
        orderBy: { date: 'desc' },
        select: {
            id: true,
            date: true,
            symbol: true,
            type: true,
            splitRatio: true,
            description: true
        }
    });

    return actions.map(tx => ({
        id: tx.id,
        date: tx.date,
        symbol: tx.symbol,
        type: tx.type,
        ratio: tx.splitRatio || 0,
        source: tx.description?.includes('Yahoo') ? 'YAHOO_MIGRATED' : 'MANUAL'
    }));
}

export async function deleteCorporateAction(id: number): Promise<void> {
    const action = await prisma.transaction.findUnique({
        where: { id }
    });
    
    if (!action) {
        throw new Error('Corporate action (transaction) not found');
    }
    
    await prisma.transaction.delete({
        where: { id }
    });
    
    revalidateApp();
}

export async function refreshCorporateActionsFromYahoo(): Promise<{ success: boolean; message: string }> {
    // DEPRECATED: Yahoo corporate actions are no longer fetched.
    // Corporate actions are now managed manually via Settings > Corporate Actions.
    return { success: false, message: 'Yahoo corporate actions are deprecated. Please manage corporate actions manually via Settings > Corporate Actions.' };
}

// Record symbol changes from import and persist mapping
export async function recordSymbolChanges(mappings: Record<string, string>): Promise<void> {
    
    for (const [oldSymbol, newSymbol] of Object.entries(mappings)) {
        // Symbol changes are now recorded in Transaction table via SYMBOL_CHANGE type
        // The import process handles this directly. This function only persists the mapping.
        
        // Persist Symbol Mapping (Future Proofing)
        // Normalize symbols before saving
        const normalizedOld = oldSymbol.toUpperCase().trim();
        const normalizedNew = newSymbol.toUpperCase().trim();
        
        await prisma.symbolMapping.upsert({
            where: { oldSymbol: normalizedOld },
            update: { newSymbol: normalizedNew },
            create: {
                oldSymbol: normalizedOld,
                newSymbol: normalizedNew
            }
        });

        console.log(`Recorded SYMBOL_CHANGE & MAPPING: ${normalizedOld} → ${normalizedNew}`);
    }
    
    revalidateApp();
}

// --- Current Stock Quantities for Import Validation ---

export async function getCurrentStockQuantities(): Promise<Record<string, number>> {
    // Fetch all transactions
    const transactions = await prisma.transaction.findMany({
        orderBy: { date: 'asc' }
    });

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);
    
    // Normalize symbols in transactions
    const normalizedTransactions = transactions.map(tx => ({
        ...tx,
        symbol: resolveSymbol(tx.symbol)
    }));

    const holdings = new Map<string, number>();
    
    // Replay transactions to build current state
    for (const tx of normalizedTransactions) {
        const symbol = tx.symbol;
        const currentQty = holdings.get(symbol) || 0;
        
        if (tx.type === 'BUY') {
            holdings.set(symbol, currentQty + tx.quantity);
        } else if (tx.type === 'SELL') {
            holdings.set(symbol, currentQty - tx.quantity);
        } else if (tx.type === 'SPLIT' || tx.type === 'BONUS') {
            const ratio = tx.splitRatio || 1;
            if (currentQty > 0) {
                holdings.set(symbol, currentQty * ratio);
            }
        }
    }
    
    // Convert to object, filter out zero/near-zero quantities
    const result: Record<string, number> = {};
    for (const [symbol, qty] of holdings) {
        if (Math.abs(qty) >= 0.01) {
            result[symbol] = qty;
        }
    }
    
    return result;
}

// --- Symbol Mapping Management ---






// --- Snapshot Fix ---

import { getDataLockDate } from '@/lib/config';

export async function fixSnapshot(date: Date, forceNSE: boolean = false) {
    // Recalculates from the given date (inclusive).
    // This will delete and recreate snapshots for this day and future days,
    // effectively "resetting" any verification status and re-running checks.

    const lockDate = await getDataLockDate();
    if (lockDate && new Date(date) <= lockDate) {
        throw new Error(`Cannot fix snapshot: Date ${new Date(date).toISOString().split('T')[0]} is locked (Data Lock Date: ${lockDate.toISOString().split('T')[0]})`);
    }

    await recalculatePortfolioHistory(date, undefined, undefined, { forceNSE });
    revalidateApp();
}



// --- Client-side NSE Corporate Actions Sync ---

export async function getPortfolioSymbols(): Promise<string[]> {
    const transactions = await prisma.transaction.findMany({
        where: { type: { in: ['BUY', 'SELL'] } },
        select: { symbol: true },
        distinct: ['symbol']
    });
    return transactions.map(t => t.symbol);
}

interface NSECorporateActionInput {
    symbol: string;
    subject: string;
    exDate: string; // "28-Jan-2025" format
}

function parseSplitBonusRatio(subject: string): { type: 'SPLIT' | 'BONUS' | null; ratio: number } {
    const subjectLower = subject.toLowerCase();
    
    // Stock Split patterns
    // "Stock Split From Rs.10/- to Rs.2/-" -> ratio = 10/2 = 5
    // "Stock Split From Rs.10/- to Re.1/-" -> ratio = 10/1 = 10
    const splitMatch = subject.match(/stock\s*split.*?(?:rs\.?|re\.?)\s*(\d+).*?(?:rs\.?|re\.?)\s*(\d+)/i);
    if (splitMatch) {
        const fromVal = parseFloat(splitMatch[1]);
        const toVal = parseFloat(splitMatch[2]);
        if (fromVal > 0 && toVal > 0) {
            return { type: 'SPLIT', ratio: fromVal / toVal };
        }
    }
    
    // Bonus patterns
    // "Bonus issue 2:1" -> ratio = 2+1 = 3 (you get 2 for every 1 held, so total = 3)
    // "Bonus 1:1" -> ratio = 2
    const bonusMatch = subject.match(/bonus.*?(\d+)\s*:\s*(\d+)/i);
    if (bonusMatch) {
        const bonusShares = parseFloat(bonusMatch[1]);
        const existingShares = parseFloat(bonusMatch[2]);
        if (bonusShares > 0 && existingShares > 0) {
            return { type: 'BONUS', ratio: (bonusShares + existingShares) / existingShares };
        }
    }
    
    // Check if it mentions split or bonus but we couldn't parse ratio
    if (subjectLower.includes('split') || subjectLower.includes('bonus')) {
        console.log(`[Corp Action] Could not parse ratio from: ${subject}`);
    }
    
    return { type: null, ratio: 1 };
}

function parseNSEDate(dateStr: string): Date | null {
    // Parse "28-Jan-2025" format
    const months: Record<string, number> = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    
    const match = dateStr.match(/(\d{1,2})-([a-zA-Z]{3})-(\d{4})/);
    if (!match) return null;
    
    const day = parseInt(match[1]);
    const month = months[match[2].toLowerCase()];
    const year = parseInt(match[3]);
    
    if (month === undefined) return null;
    
    return new Date(year, month, day);
}

export async function processNSECorporateActionsClient(
    nseActions: NSECorporateActionInput[]
): Promise<{ success: boolean; message: string; actionsAdded: number }> {
    try {
        // Get portfolio symbols
        const portfolioSymbols = await getPortfolioSymbols();
        const portfolioSet = new Set(portfolioSymbols.map(s => s.toUpperCase()));
        
        console.log(`[Client Corp Action Sync] Processing ${nseActions.length} NSE actions for ${portfolioSymbols.length} portfolio symbols`);
        
        // Get existing corporate actions to avoid duplicates
        const existingActions = await prisma.transaction.findMany({
            where: { type: { in: ['SPLIT', 'BONUS'] } },
            select: { symbol: true, date: true, type: true }
        });
        
        const existingSet = new Set(
            existingActions.map(a => `${a.symbol}-${a.date.toISOString().split('T')[0]}-${a.type}`)
        );
        
        let actionsAdded = 0;
        
        for (const action of nseActions) {
            // Check if symbol is in portfolio
            if (!portfolioSet.has(action.symbol.toUpperCase())) continue;
            
            // Parse the action
            const { type, ratio } = parseSplitBonusRatio(action.subject);
            if (!type) continue;
            
            // Parse date
            const exDate = parseNSEDate(action.exDate);
            if (!exDate) continue;
            
            const dateStr = exDate.toISOString().split('T')[0];
            const key = `${action.symbol.toUpperCase()}-${dateStr}-${type}`;
            
            // Skip if already exists
            if (existingSet.has(key)) {
                console.log(`[Client Corp Action Sync] Skipping duplicate: ${key}`);
                continue;
            }
            
            // Add the corporate action
            await addCorporateAction({
                symbol: action.symbol,
                date: dateStr,
                type: type,
                ratio: String(ratio),
                description: `Auto-synced from NSE: ${action.subject}`
            });
            actionsAdded++;
            console.log(`[Client Corp Action Sync] Added: ${action.symbol} ${type} ${ratio}:1 on ${dateStr}`);
        }
        
        if (actionsAdded > 0) {
            // Trigger portfolio recalculation
            await recalculatePortfolioHistory();
            revalidateApp();
        }
        
        return {
            success: true,
            message: actionsAdded > 0 
                ? `Added ${actionsAdded} corporate action(s)` 
                : 'No new corporate actions found for your portfolio',
            actionsAdded
        };
        
    } catch (error) {
        console.error('[Client Corp Action Sync] Error:', error);
        return {
            success: false,
            message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
            actionsAdded: 0
        };
    }
}
