/**
 * Script to backfill historical daily market breadth and health metrics
 * from ScreenerPrice and MomentumScore, saving to AppConfig.
 *
 * Usage:
 *   npx tsx scripts/backfill-market-health.ts
 */

import * as fs from 'fs';
import { createClient } from '@libsql/client';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf-8').split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const TURSO_URL = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_URL.startsWith('libsql')) {
  console.error('❌ DATABASE_URL (or TURSO_DATABASE_URL) must point to a libsql:// Turso database');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

interface HealthDayRecord {
  date: string;
  totalStocks: number;
  pctAbove200Dma: number;
  pctAbove100Dma: number;
  pctAbove50Dma: number;
  pctAbove20Dma: number;
  pctNearAth10: number;
  pctNearAth20: number;
  pctNearAth30: number;
}

async function main() {
  console.log('🚀 Connecting to Turso:', TURSO_URL);

  // 1. Fetch exact MomentumScore aggregated history
  console.log('[1/4] Querying MomentumScore aggregates...');
  const msRes = await client.execute(`
    SELECT 
      computedDate as date,
      COUNT(*) as totalStocks,
      ROUND(AVG(aboveDma200Pct > 0) * 100, 1) as pctAbove200Dma,
      ROUND(AVG(aboveDma100) * 100, 1) as pctAbove100Dma,
      ROUND(AVG(aboveDma50) * 100, 1) as pctAbove50Dma,
      ROUND(AVG(aboveDma20) * 100, 1) as pctAbove20Dma,
      ROUND(AVG(athProximity >= 0.90) * 100, 1) as pctNearAth10,
      ROUND(AVG(athProximity >= 0.80) * 100, 1) as pctNearAth20,
      ROUND(AVG(athProximity >= 0.70) * 100, 1) as pctNearAth30
    FROM "MomentumScore"
    WHERE rankType = 'all'
    GROUP BY computedDate
    ORDER BY computedDate ASC
  `);

  const msMap = new Map<string, HealthDayRecord>();
  for (const r of msRes.rows) {
    msMap.set(r.date as string, {
      date: r.date as string,
      totalStocks: Number(r.totalStocks),
      pctAbove200Dma: Number(r.pctAbove200Dma),
      pctAbove100Dma: Number(r.pctAbove100Dma),
      pctAbove50Dma: Number(r.pctAbove50Dma),
      pctAbove20Dma: Number(r.pctAbove20Dma),
      pctNearAth10: Number(r.pctNearAth10),
      pctNearAth20: Number(r.pctNearAth20),
      pctNearAth30: Number(r.pctNearAth30),
    });
  }
  console.log(`  Found ${msMap.size} scored days in MomentumScore (${msRes.rows[0]?.date} to ${msRes.rows[msRes.rows.length - 1]?.date})`);

  // 2. Fetch ScreenerPrice records
  console.log('[2/4] Fetching ScreenerPrice history...');
  const t0 = Date.now();
  const spRes = await client.execute(`
    SELECT symbol, date, high, close
    FROM ScreenerPrice
    ORDER BY symbol ASC, date ASC
  `);
  console.log(`  Loaded ${spRes.rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

  // Group by symbol
  const symbolPrices = new Map<string, { date: string; high: number; close: number }[]>();
  const dateCounts = new Map<string, number>();

  for (const r of spRes.rows) {
    const s = r.symbol as string;
    const d = r.date as string;

    let arr = symbolPrices.get(s);
    if (!arr) {
      arr = [];
      symbolPrices.set(s, arr);
    }
    arr.push({
      date: d,
      high: r.high as number,
      close: r.close as number,
    });

    dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
  }

  // Filter genuine trading dates (>= 1000 stocks to exclude weekend/holiday anomalies)
  const genuineTradingDates = Array.from(dateCounts.entries())
    .filter(([, count]) => count >= 1000)
    .map(([date]) => date)
    .sort();

  console.log(`  Identified ${genuineTradingDates.length} genuine trading days (${genuineTradingDates[0]} to ${genuineTradingDates[genuineTradingDates.length - 1]})`);

  // We need 200 trading days for 200 DMA calculation
  const genuineDateSet = new Set(genuineTradingDates);
  const tradingDaysFrom200 = genuineTradingDates.slice(199);
  console.log(`  ${tradingDaysFrom200.length} trading days have >= 200 DMA history (${tradingDaysFrom200[0]} to ${tradingDaysFrom200[tradingDaysFrom200.length - 1]})`);

  // 3. Compute sliding DMAs & ATH Proximity
  console.log('[3/4] Computing historical sliding DMAs and ATH proximity...');
  const calcT0 = Date.now();
  const dailyAgg = new Map<string, {
    totalStocks: number;
    above200: number;
    above100: number;
    above50: number;
    above20: number;
    nearAth10: number;
    nearAth20: number;
    nearAth30: number;
  }>();

  for (const date of tradingDaysFrom200) {
    dailyAgg.set(date, {
      totalStocks: 0,
      above200: 0,
      above100: 0,
      above50: 0,
      above20: 0,
      nearAth10: 0,
      nearAth20: 0,
      nearAth30: 0,
    });
  }

  for (const [, prices] of symbolPrices) {
    const validPrices = prices.filter(p => genuineDateSet.has(p.date));
    let sum20 = 0, sum50 = 0, sum100 = 0, sum200 = 0;
    let runningAth = 0;

    for (let i = 0; i < validPrices.length; i++) {
      const p = validPrices[i];
      if (p.high > runningAth) runningAth = p.high;

      sum20 += p.close;
      if (i >= 20) sum20 -= validPrices[i - 20].close;

      sum50 += p.close;
      if (i >= 50) sum50 -= validPrices[i - 50].close;

      sum100 += p.close;
      if (i >= 100) sum100 -= validPrices[i - 100].close;

      sum200 += p.close;
      if (i >= 200) sum200 -= validPrices[i - 200].close;

      const agg = dailyAgg.get(p.date);
      if (!agg) continue;

      if (i >= 199) {
        agg.totalStocks++;
        const dma200 = sum200 / 200;
        const dma100 = sum100 / 100;
        const dma50 = sum50 / 50;
        const dma20 = sum20 / 20;

        if (p.close >= dma200) agg.above200++;
        if (p.close >= dma100) agg.above100++;
        if (p.close >= dma50) agg.above50++;
        if (p.close >= dma20) agg.above20++;

        if (runningAth > 0) {
          const prox = p.close / runningAth;
          if (prox >= 0.90) agg.nearAth10++;
          if (prox >= 0.80) agg.nearAth20++;
          if (prox >= 0.70) agg.nearAth30++;
        }
      }
    }
  }
  console.log(`  Sliding window calculation completed in ${((Date.now() - calcT0) / 1000).toFixed(2)}s`);

  // Build combined history
  const finalHistory: HealthDayRecord[] = [];
  for (const date of tradingDaysFrom200) {
    const fromMs = msMap.get(date);
    if (fromMs) {
      finalHistory.push(fromMs);
      continue;
    }

    const agg = dailyAgg.get(date)!;
    const total = agg.totalStocks || 1;

    finalHistory.push({
      date,
      totalStocks: total,
      pctAbove200Dma: Number(((agg.above200 / total) * 100).toFixed(1)),
      pctAbove100Dma: Number(((agg.above100 / total) * 100).toFixed(1)),
      pctAbove50Dma: Number(((agg.above50 / total) * 100).toFixed(1)),
      pctAbove20Dma: Number(((agg.above20 / total) * 100).toFixed(1)),
      pctNearAth10: Number(((agg.nearAth10 / total) * 100).toFixed(1)),
      pctNearAth20: Number(((agg.nearAth20 / total) * 100).toFixed(1)),
      pctNearAth30: Number(((agg.nearAth30 / total) * 100).toFixed(1)),
    });
  }

  console.log(`  Combined total records: ${finalHistory.length} trading days`);

  // 4. Save to AppConfig in Turso
  console.log('[4/4] Upserting market_health_history_daily into AppConfig...');
  const jsonValue = JSON.stringify(finalHistory);
  const now = new Date().toISOString();

  await client.execute({
    sql: `
      INSERT INTO AppConfig (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
    `,
    args: ['market_health_history_daily', jsonValue, now],
  });

  console.log(`✅ Successfully backfilled and stored ${finalHistory.length} days of market health history in AppConfig!`);
  console.log(`   Earliest date: ${finalHistory[0].date} (${finalHistory[0].pctAbove200Dma}% above 200 DMA)`);
  console.log(`   Latest date:   ${finalHistory[finalHistory.length - 1].date} (${finalHistory[finalHistory.length - 1].pctAbove200Dma}% above 200 DMA)`);
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
