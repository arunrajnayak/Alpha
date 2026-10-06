/**
 * Corporate action detection via price anomalies and fundamentals API.
 * Scans ScreenerPrice for abnormal daily moves that indicate splits/bonus.
 * Also monitors recent portfolio corporate actions (splits/bonuses).
 * On detection: flush all candles for that stock and re-fetch from Upstox (adjusted prices).
 */

import { prisma } from '@/lib/db';
import { flushAndRefetchStock } from './prices';
import { withConcurrency } from './utils';
import { logger } from '@/lib/logger';
import { seedATH } from './ath';
import { getInstrumentData } from '@/lib/instrument-service';
import { getCorporateActionsByISIN } from '@/lib/upstox-client';
import { parseUpstoxCorporateAction } from '@/lib/corporate-actions';
import { subDays } from 'date-fns';

const caLogger = logger.scope('CorpActions');

// Thresholds matching backtest detection
const DROP_THRESHOLD = -0.20;  // >20% daily drop
const JUMP_THRESHOLD = 0.80;   // >80% daily jump

/**
 * Detect price anomalies in ScreenerPrice and flush + re-fetch affected stocks.
 * Scans the last 5 trading days for any stock showing extreme daily moves,
 * and incorporates confirmed corporate actions from portfolio transactions and Upstox.
 */
export async function detectAndFlushAnomalies(): Promise<{ flushed: string[] }> {
  const flushed: string[] = [];

  // Get distinct symbols with recent data
  const recentDates = await prisma.screenerPrice.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: 6, // Need 6 dates to compute 5 days of returns
  });

  if (recentDates.length < 2) return { flushed };

  const dateCutoff = recentDates[recentDates.length - 1].date;

  // Load recent prices for all stocks
  const recentPrices = await prisma.screenerPrice.findMany({
    where: { date: { gte: dateCutoff } },
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, instrumentKey: true, date: true, close: true },
  });

  // Group by symbol
  const bySymbol = new Map<string, Array<{ date: string; close: number; instrumentKey: string }>>();
  for (const p of recentPrices) {
    let arr = bySymbol.get(p.symbol);
    if (!arr) {
      arr = [];
      bySymbol.set(p.symbol, arr);
    }
    arr.push({ date: p.date, close: p.close, instrumentKey: p.instrumentKey });
  }

  // Detect anomalies first, then flush in parallel
  const anomalies: Array<{ symbol: string; instrumentKey: string; date: string; pct: string; reason?: string }> = [];
  const anomalySymbols = new Set<string>();

  for (const [symbol, prices] of bySymbol) {
    if (prices.length < 2) continue;

    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1].close === 0) continue;

      const dailyReturn = (prices[i].close - prices[i - 1].close) / prices[i - 1].close;

      if (dailyReturn <= DROP_THRESHOLD || dailyReturn >= JUMP_THRESHOLD) {
        caLogger.warn(
          `Anomaly detected: ${symbol} on ${prices[i].date}: ${(dailyReturn * 100).toFixed(1)}% ` +
          `(${prices[i - 1].close} → ${prices[i].close})`
        );
        anomalies.push({
          symbol,
          instrumentKey: prices[i].instrumentKey,
          date: prices[i].date,
          pct: (dailyReturn * 100).toFixed(1),
          reason: 'price_threshold',
        });
        anomalySymbols.add(symbol);
        break; // Only one anomaly per symbol
      }
    }
  }

  // Also check portfolio corporate actions from the last 14 days
  // (e.g. stock split or bonus recorded in Transaction table)
  try {
    const recentCorpActionTxs = await prisma.transaction.findMany({
      where: {
        type: { in: ['SPLIT', 'BONUS'] },
        date: { gte: subDays(new Date(), 14) },
      },
      select: { symbol: true, type: true, splitRatio: true },
      distinct: ['symbol'],
    });

    for (const tx of recentCorpActionTxs) {
      if (!anomalySymbols.has(tx.symbol)) {
        const instData = await getInstrumentData(tx.symbol);
        if (instData?.key) {
          caLogger.info(`Adding ${tx.symbol} for corporate action verification (${tx.type} ratio=${tx.splitRatio})`);
          anomalies.push({
            symbol: tx.symbol,
            instrumentKey: instData.key,
            date: dateCutoff,
            pct: 'N/A',
            reason: `portfolio_${tx.type.toLowerCase()}`,
          });
          anomalySymbols.add(tx.symbol);
        }
      }
    }
  } catch (err) {
    caLogger.warn('Error checking portfolio corporate action transactions:', err);
  }

  // Flush detected anomalies serially with 500ms spacing.
  // Each flushAndRefetchStock calls getHistoricalCandles (1 API call per stock).
  // Serial avoids burst against the 50 req/s, 500 req/min Upstox rate limit,
  // and corp action anomalies are typically 0-5 stocks per day.
  if (anomalies.length > 0) {
    const result = await withConcurrency(anomalies, async (a) => {
      // Check Upstox Fundamentals API if ISIN available to verify event details
      try {
        const instData = await getInstrumentData(a.symbol);
        if (instData?.isin) {
          const events = await getCorporateActionsByISIN(instData.isin);
          for (const ev of events) {
            const parsed = parseUpstoxCorporateAction(ev);
            if (parsed.type && parsed.ratio > 1) {
              caLogger.info(`Confirmed ${parsed.type} for ${a.symbol} via Upstox Fundamentals: ratio=${parsed.ratio}:1 on ${parsed.dateStr}`);
            }
          }
        }
      } catch (checkErr) {
        caLogger.debug(`Upstox verification check skipped for ${a.symbol}:`, checkErr);
      }

      await flushAndRefetchStock(a.symbol, a.instrumentKey);
      try {
        await seedATH([{ symbol: a.symbol, instrumentKey: a.instrumentKey }]);
        caLogger.info(`Re-seeded ATH for ${a.symbol} after corporate action anomaly`);
      } catch (athErr) {
        caLogger.error(`Failed to re-seed ATH for ${a.symbol}:`, athErr);
      }
      flushed.push(a.symbol);
    }, 1, 0, 500);

    if (result.errors.length > 0) {
      caLogger.error(`${result.errors.length} flush failures:`, result.errors);
    }
    caLogger.info(`Flushed and re-fetched ${flushed.length} stocks: ${flushed.join(', ')}`);
  }

  return { flushed };
}
