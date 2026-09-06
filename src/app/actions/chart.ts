'use server';

import { prisma } from '@/lib/db';
import { getHistoricalCandles, getIntradayCandles, UpstoxCandle } from '@/lib/upstox-client';
import { getInstrumentKey, getLiveQuotes } from '@/lib/upstox';
import type { CandleData, TradeMarker, ChartInterval } from '@/lib/chart-types';

/**
 * Fetch OHLCV candle data for a stock from Upstox API.
 * Supports '5minute' intraday and 'day', 'week', 'month'.
 */
export async function getStockCandles(
    symbol: string,
    interval: ChartInterval,
    fromDate: string,  // YYYY-MM-DD
    toDate: string     // YYYY-MM-DD
): Promise<CandleData[]> {
    const instrumentKey = await getInstrumentKey(symbol);
    if (!instrumentKey) {
        throw new Error(`Unknown symbol: ${symbol}`);
    }

    if (interval === '5minute') {
        // Upstox max range for 5-minute historical is ~30 days
        const min5mFromDate = new Date(toDate);
        min5mFromDate.setDate(min5mFromDate.getDate() - 30);
        const min5mFromDateStr = min5mFromDate.toISOString().split('T')[0];
        const safe5mFromDate = fromDate < min5mFromDateStr ? min5mFromDateStr : fromDate;

        // Fetch historical 5m candles and today's intraday 5m candles
        const [historicalRes, intradayRes] = await Promise.all([
            getHistoricalCandles(instrumentKey, '5minute', safe5mFromDate, toDate).catch(() => ({ candles: [] })),
            getIntradayCandles(instrumentKey, '5minute').catch(() => ({ candles: [] })),
        ]);

        // Merge and deduplicate by timestamp
        const candleMap = new Map<string, UpstoxCandle>();
        for (const c of historicalRes.candles) {
            candleMap.set(c.timestamp, c);
        }
        for (const c of intradayRes.candles) {
            candleMap.set(c.timestamp, c);
        }

        const merged = Array.from(candleMap.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Offset timestamp by IST (+05:30 = 19,800s) so Lightweight Charts UTC timescale displays IST time
        const IST_OFFSET_SECONDS = 19800;

        return merged.map(c => {
            const utcSeconds = Math.floor(new Date(c.timestamp).getTime() / 1000);
            return {
                time: utcSeconds + IST_OFFSET_SECONDS,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
            };
        });
    }

    // Daily / Weekly / Monthly timeframe
    // For daily timeframe, fetch an extra 365 calendar days before fromDate so 200 DMA is available from day 1
    let fetchFromDate = fromDate;
    if (interval === 'day') {
        const extDateObj = new Date(fromDate);
        extDateObj.setDate(extDateObj.getDate() - 365);
        fetchFromDate = extDateObj.toISOString().split('T')[0];
    }

    // Upstox max date range for historical candle API is 10 years
    const minFromDateObj = new Date(toDate);
    minFromDateObj.setFullYear(minFromDateObj.getFullYear() - 10);
    const minFromDateStr = minFromDateObj.toISOString().split('T')[0];
    const safeFromDate = fetchFromDate < minFromDateStr ? minFromDateStr : fetchFromDate;

    const { candles } = await getHistoricalCandles(instrumentKey, interval, safeFromDate, toDate).catch((err) => {
        console.warn(`Historical candles fetch failed for ${symbol} (${safeFromDate} to ${toDate}):`, err?.message || err);
        return { candles: [] };
    });

    // Transform Upstox candles → Lightweight Charts format (YYYY-MM-DD)
    return candles.map(c => ({
        time: c.timestamp.slice(0, 10), // YYYY-MM-DD
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }))
    .sort((a, b) => (a.time as string).localeCompare(b.time as string));
}

/**
 * Fetch all buy/sell trades for a stock to display as markers on the chart.
 * Deduplicates multiple buys or sells on the same date into a single marker.
 */
export async function getStockTrades(symbol: string): Promise<TradeMarker[]> {
    const transactions = await prisma.transaction.findMany({
        where: {
            symbol: symbol.toUpperCase(),
            type: { in: ['BUY', 'SELL'] },
        },
        orderBy: { date: 'asc' },
        select: {
            date: true,
            type: true,
            price: true,
            quantity: true,
        },
    });

    // Deduplicate trades by (date, type) so multiple buys/sells on the same day show as one marker
    const tradesByDateType = new Map<string, { time: string; type: 'BUY' | 'SELL'; price: number; quantity: number }>();

    for (const t of transactions) {
        const dateStr = t.date.toISOString().split('T')[0];
        const key = `${dateStr}_${t.type}`;
        const existing = tradesByDateType.get(key);
        if (!existing) {
            tradesByDateType.set(key, {
                time: dateStr,
                type: t.type as 'BUY' | 'SELL',
                price: t.price,
                quantity: t.quantity,
            });
        } else {
            // Aggregate quantity and weighted average price
            const totalQty = existing.quantity + t.quantity;
            const avgPrice = totalQty > 0
                ? (existing.price * existing.quantity + t.price * t.quantity) / totalQty
                : existing.price;
            existing.quantity = totalQty;
            existing.price = Number(avgPrice.toFixed(2));
        }
    }

    return Array.from(tradesByDateType.values()).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Fetch stock info for the header: current price, change, portfolio status.
 */
export async function getStockInfo(symbol: string): Promise<{
    symbol: string;
    instrumentKey?: string;
    currentPrice?: number;
    previousClose?: number;
    change?: number;
    changePercent?: number;
    inPortfolio: boolean;
    quantity?: number;
    invested?: number;
    pnl?: number;
    pnlPercent?: number;
} | null> {
    const upperSymbol = symbol.toUpperCase();
    const instrumentKey = await getInstrumentKey(upperSymbol);

    let currentPrice: number | undefined;
    let previousClose: number | undefined;

    // Get live price from Upstox
    if (instrumentKey) {
        try {
            const quotes = await getLiveQuotes([instrumentKey]);
            const quote = quotes.get(instrumentKey);
            if (quote) {
                currentPrice = quote.last_price;
                previousClose = quote.previous_close;
            }
        } catch {
            // Fall back to latest ScreenerPrice if live quotes fail
        }
    }

    // Fallback: get latest close from ScreenerPrice
    if (currentPrice === undefined) {
        const latest = await prisma.screenerPrice.findFirst({
            where: { symbol: upperSymbol },
            orderBy: { date: 'desc' },
            select: { close: true },
        });
        if (latest) {
            currentPrice = latest.close;
        }
    }

    // Calculate change
    let change: number | undefined;
    let changePercent: number | undefined;
    if (currentPrice !== undefined && previousClose !== undefined && previousClose > 0) {
        change = currentPrice - previousClose;
        changePercent = (change / previousClose) * 100;
    }

    // Check portfolio status by computing net position from transactions
    const transactions = await prisma.transaction.findMany({
        where: { symbol: upperSymbol, type: { in: ['BUY', 'SELL'] } },
        select: { type: true, quantity: true, price: true },
    });

    let totalQty = 0;
    let totalInvested = 0;
    for (const t of transactions) {
        if (t.type === 'BUY') {
            totalQty += t.quantity;
            totalInvested += t.quantity * t.price;
        } else {
            // Reduce invested proportionally on sell
            if (totalQty > 0) {
                const avgCost = totalInvested / totalQty;
                totalQty -= t.quantity;
                totalInvested -= t.quantity * avgCost;
            }
        }
    }

    const inPortfolio = totalQty > 0.001;
    let pnl: number | undefined;
    let pnlPercent: number | undefined;

    if (inPortfolio && currentPrice !== undefined) {
        const currentValue = totalQty * currentPrice;
        pnl = currentValue - totalInvested;
        pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
    }

    return {
        symbol: upperSymbol,
        instrumentKey,
        currentPrice,
        previousClose,
        change,
        changePercent,
        inPortfolio,
        quantity: inPortfolio ? totalQty : undefined,
        invested: inPortfolio ? totalInvested : undefined,
        pnl,
        pnlPercent,
    };
}
