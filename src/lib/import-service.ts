import { parse } from 'csv-parse/sync';

import { recalculatePortfolioHistory } from './finance';
import { prisma } from '@/lib/db';
import { revalidateApp } from '@/app/actions';
import { parseFlexibleDate } from '@/lib/format';
import { getSymbolResolver } from './amfi-service';

// Zerodha Tradebook has columns: symbol, isin, trade_date, exchange, segment, series, trade_type, auction, quantity, price, trade_id, order_id, order_execution_time
export type ZerodhaTrade = {
  symbol: string;
  trade_date: string;
  trade_type: string; // "buy" or "sell"
  quantity: string;
  price: string;
  order_id: string; // using trade_id or order_id
  trade_id: string;
  order_execution_time?: string;
};

export type ProgressCallback = (message: string, progress: number) => void;

export type ParsedTrade = {
    symbol: string;
    date: string;
    type: "buy" | "sell";
    quantity: number;
    price: number;
    orderId: string;
    tradeId: string;
}; // Matching what might be sent from client JSON

export async function ingestZerodhaTradesWithProgress(
    formData: FormData, 
    onProgress?: ProgressCallback
) {
    const file = formData.get('file') as File;
    const tradesJson = formData.get('trades_json') as string;
    const mappingsJson = formData.get('mappings') as string;

    if (!file && !tradesJson) {
        throw new Error('No file or trades data uploaded');
    }

    onProgress?.("Reading file...", 5);

    let records: ZerodhaTrade[] = [];
    let filename = file ? file.name : 'manual-upload.csv';
    let mappings: Record<string, string> = {};

    try {
        if (mappingsJson) {
            mappings = JSON.parse(mappingsJson);
        }

        if (tradesJson) {
            // Input from client-side filtered list
            const parsedTrades = JSON.parse(tradesJson) as ParsedTrade[];
            records = parsedTrades.map((t) => ({
                symbol: t.symbol,
                trade_date: t.date,
                trade_type: t.type,
                quantity: t.quantity.toString(),
                price: t.price.toString(),
                order_id: t.orderId,
                trade_id: t.tradeId || ''
            }));
            filename = 'manual-filtered-import.json';

        } else {
            // Original CSV parsing logic
            const text = await file.text();
            records = parse(text, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
            }) as ZerodhaTrade[];
        }

        return await processZerodhaTradesCore(records, filename, onProgress, mappings);
        
    } catch (error) {
        console.error('Error parsing CSV:', error);
        throw new Error('Failed to parse CSV file. Ensure it is a valid Zerodha Tradebook.');
    }
}

export async function processZerodhaTradesCore(
    records: ZerodhaTrade[], 
    filename: string, 
    onProgress?: ProgressCallback,
    mappings?: Record<string, string>
) {
    onProgress?.("Consolidating trades...", 10);

    // --- Consolidation Logic ---
    const consolidatedMap = new Map<string, {
      date: Date;
      symbol: string;
      type: string;
      totalQuantity: number;
      totalCost: number; // For weighted average price
      ids: string[]; // Track original IDs for composite ID
    }>();

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);

    for (const record of records) {
        if (!record.symbol || !record.trade_date) continue;

        // Apply symbol normalization BEFORE consolidation
        const symbol = resolveSymbol(record.symbol);

        // Date Parsing - use consolidated date parser
        const date = parseFlexibleDate(record.trade_date);

        if (isNaN(date.getTime())) {
             console.error(`Failed to parse date for ${record.symbol}: ${record.trade_date}`);
             continue;
        }
        
        // Normalize Date to start of day (UTC) for grouping
        date.setUTCHours(0, 0, 0, 0);

        const qty = parseFloat(record.quantity);
        const price = parseFloat(record.price);
        const type = record.trade_type.toLowerCase().trim() === 'buy' ? 'BUY' : 'SELL';
        
        const key = `${symbol}-${date.toISOString()}-${type}`;

        if (!consolidatedMap.has(key)) {
          consolidatedMap.set(key, {
            date,
            symbol,
            type,
            totalQuantity: 0,
            totalCost: 0,
            ids: []
          });
        }

        const entry = consolidatedMap.get(key)!;
        entry.totalQuantity += qty;
        entry.totalCost += (qty * price);
        entry.ids.push(record.trade_id || record.order_id);
    }
    
    onProgress?.("Calculating date range...", 20);

    // Calculate date range
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    
    for (const item of consolidatedMap.values()) {
        if (!minDate || item.date < minDate) minDate = item.date;
        if (!maxDate || item.date > maxDate) maxDate = item.date;
    }

    if (consolidatedMap.size === 0) {
        return { success: true, count: 0, batchId: null };
    }

    onProgress?.(`Saving ${consolidatedMap.size} consolidated trades to database...`, 30);

    // Create Import Batch
    // Wrap database operations in a transaction
    const { batchId, importedCount } = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          filename,
          count: consolidatedMap.size,
          startDate: minDate,
          endDate: maxDate
        }
      });

      // Prepare batch data for bulk insert
      const transactionData = Array.from(consolidatedMap.values())
          .filter(item => item.totalQuantity > 0) // Guard against zero quantity
          .map(item => {
              // Safe division - totalQuantity is guaranteed > 0 from filter above
              const avgPrice = item.totalCost / item.totalQuantity;
              // Composite ID for consolidated trade
              const uniqueId = `BATCH-${batch.id}-${item.symbol}-${item.date.toISOString()}-${item.type}`;
              
              return {
                  date: item.date,
                  symbol: item.symbol,
                  type: item.type,
                  quantity: item.totalQuantity,
                  price: avgPrice,
                  orderId: uniqueId,
                  importBatchId: batch.id
              };
          });

      // Bulk insert all transactions at once
      const result = await tx.transaction.createMany({
          data: transactionData
      });

      // Persist Symbol Mappings if provided (upsert requires individual calls)
      if (mappings && Object.keys(mappings).length > 0) {
          const mappingPromises = Object.entries(mappings).map(([oldSymbol, newSymbol]) => {
              const normalizedOld = oldSymbol.toUpperCase().trim();
              const normalizedNew = newSymbol.toUpperCase().trim();

              return tx.symbolMapping.upsert({
                  where: { oldSymbol: normalizedOld },
                  update: { newSymbol: normalizedNew },
                  create: {
                      oldSymbol: normalizedOld,
                      newSymbol: normalizedNew
                  }
              }).then(() => {
                  console.log(`[Import] Recorded Symbol Mapping: ${normalizedOld} → ${normalizedNew}`);
              });
          });
          await Promise.all(mappingPromises);
      }

      return { batchId: batch.id, importedCount: result.count };
    });

    onProgress?.("Trades saved. Starting full portfolio recalculation...", 40);

    // Trigger recalculation (Optimized: Start from earliest date in batch)
    // Pass the progress callback to recalculatePortfolioHistory
    // Ranging from 40% to 100%
    await recalculatePortfolioHistory(minDate || undefined, (msg, p) => {
        // Map inner progress (0-100) to outer progress (40-100)
        // newP = 40 + (p * 0.6)
        const remapped = 40 + Math.floor(p * 0.6);
        onProgress?.(msg, remapped);
    });

    // 5. Revalidate App (Clear Server Cache)
    await revalidateApp();

    onProgress?.("Import complete!", 100);

    return { success: true, count: importedCount, batchId: batchId };
}

// --- Order Sync (Non-Consolidated, Deduplicated by Order ID) ---

export interface KiteOrder {
    orderId: string;
    symbol: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    averagePrice: number;
    orderTimestamp: Date;
}

export interface OrderSyncResult {
    success: boolean;
    synced: number;
    skipped: number;
    batchId: number | null;
}

/**
 * Ingest orders from Kite with deduplication based on orderId.
 * Unlike processZerodhaTradesCore, this does NOT consolidate trades by date/symbol/type.
 * Each order is stored individually, enabling proper short-sell tracking.
 */
export async function ingestOrdersWithDeduplication(
    orders: KiteOrder[],
    filename: string = 'kite-sync',
    onProgress?: ProgressCallback
): Promise<OrderSyncResult> {
    if (orders.length === 0) {
        return { success: true, synced: 0, skipped: 0, batchId: null };
    }

    onProgress?.("Checking for duplicate orders...", 10);

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);

    // Normalize symbols in incoming orders
    const normalizedOrders = orders.map(o => ({
        ...o,
        symbol: resolveSymbol(o.symbol)
    }));

    // Get existing order IDs to check for duplicates
    const orderIds = normalizedOrders.map(o => o.orderId);
    const existingOrders = await prisma.transaction.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true }
    });
    const existingOrderIds = new Set(existingOrders.map(o => o.orderId));

    // Filter out duplicates
    const newOrders = normalizedOrders.filter(o => !existingOrderIds.has(o.orderId));
    const skippedCount = orders.length - newOrders.length;

    if (newOrders.length === 0) {
        onProgress?.("All orders already exist. Nothing to sync.", 100);
        return { success: true, synced: 0, skipped: skippedCount, batchId: null };
    }

    onProgress?.(`Found ${newOrders.length} new orders to sync...`, 20);

    // Calculate date range
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    
    for (const order of newOrders) {
        const orderDate = new Date(order.orderTimestamp);
        orderDate.setUTCHours(0, 0, 0, 0);
        
        if (!minDate || orderDate < minDate) minDate = orderDate;
        if (!maxDate || orderDate > maxDate) maxDate = orderDate;
    }

    onProgress?.(`Saving ${newOrders.length} orders to database...`, 30);

    // Create Import Batch and insert orders
    const { batchId, importedCount } = await prisma.$transaction(async (tx) => {
        const batch = await tx.importBatch.create({
            data: {
                filename,
                count: newOrders.length,
                startDate: minDate,
                endDate: maxDate
            }
        });

        // Prepare batch data for bulk insert
        const orderData = newOrders.map(order => {
            // Normalize date to UTC midnight
            const orderDate = new Date(order.orderTimestamp);
            orderDate.setUTCHours(0, 0, 0, 0);

            return {
                date: orderDate,
                symbol: order.symbol,
                type: order.transactionType,
                quantity: order.quantity,
                price: order.averagePrice,
                orderId: order.orderId,
                importBatchId: batch.id
            };
        });

        // Bulk insert all orders at once
        const result = await tx.transaction.createMany({
            data: orderData
        });

        return { batchId: batch.id, importedCount: result.count };
    });

    onProgress?.("Orders saved. Starting portfolio recalculation...", 40);

    // Trigger recalculation from earliest order date
    await recalculatePortfolioHistory(minDate || undefined, (msg, p) => {
        const remapped = 40 + Math.floor(p * 0.6);
        onProgress?.(msg, remapped);
    });

    // Revalidate App
    await revalidateApp();

    onProgress?.(`Sync complete! ${importedCount} orders synced, ${skippedCount} skipped.`, 100);

    return { 
        success: true, 
        synced: importedCount, 
        skipped: skippedCount, 
        batchId 
    };
}

