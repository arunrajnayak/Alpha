/**
 * Shows per-filter breakdown of qualifying stocks.
 * Usage: node_modules/.bin/tsx scripts/filter-breakdown.ts
 */

import { gunzipSync } from 'zlib';
import { prisma } from './lib/db';
import { buildPrefixSums, movingAveragePrefix, median, computeReturns, sharpeRatio, PARAMS } from '../src/lib/screener/scoring';

const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

async function main() {
  console.log('\n=== Screener Filter Breakdown ===\n');

  // Load data
  const [mcapRows, athRows, allPrices] = await Promise.all([
    prisma.stockMarketCap.findMany({ select: { symbol: true, marketCap: true } }),
    prisma.stockATH.findMany({ select: { symbol: true, ath: true } }),
    prisma.screenerPrice.findMany({
      orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
      select: { symbol: true, close: true, high: true, volume: true },
    }),
  ]);

  const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  const athMap  = new Map(athRows.map(r => [r.symbol, r.ath]));

  type Candle = { close: number; high: number; volume: number };
  const pricesBySymbol = new Map<string, Candle[]>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ close: p.close, high: p.high, volume: p.volume });
  }

  // Load instruments
  const res = await fetch(NSE_INSTRUMENTS_URL);
  const data = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
  interface RawInst { instrument_key: string; tradingsymbol?: string; trading_symbol?: string; instrument_type: string; }
  const instruments: string[] = (data as RawInst[])
    .filter(i => i.instrument_type === 'EQ' && i.instrument_key?.startsWith('NSE_EQ'))
    .map(i => ((i.tradingsymbol ?? i.trading_symbol ?? '') as string).toUpperCase())
    .filter(Boolean);

  const total = instruments.length;

  // Per-filter counters (cumulative — each filter applied on stocks that passed all previous)
  let afterMcap = 0;
  let afterHistory = 0;
  let afterDma200 = 0;
  let afterPrice = 0;
  let afterATH = 0;
  let afterVolume = 0;
  let afterSharpe = 0; // final

  // Fail-only counters (to show what each filter specifically removes)
  let failMcap = 0;
  let failHistory = 0;
  let failDma200 = 0;
  let failPrice = 0;
  let failATH = 0;
  let failVolume = 0;
  let failSharpe = 0;

  const skipDays = PARAMS.skipMonths * 21;

  for (const symbol of instruments) {
    // 1. Market cap
    const mcap = mcapMap.get(symbol);
    if (!mcap || mcap < PARAMS.mcapMinCr) { failMcap++; continue; }
    afterMcap++;

    // 2. Price history
    const candles = pricesBySymbol.get(symbol);
    if (!candles || candles.length < 248) { failHistory++; continue; }
    afterHistory++;

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const volumes = candles.map(c => c.volume);
    const dateIdx = closes.length - 1;
    const effectiveIdx = dateIdx - skipDays;

    if (dateIdx < 247) { failHistory++; afterHistory--; continue; }

    const currentClose = closes[dateIdx];

    // 3. 200 DMA
    const prefixSums = buildPrefixSums(closes);
    const dma200 = movingAveragePrefix(prefixSums, dateIdx, 200);
    if (dma200 === null || currentClose < dma200) { failDma200++; continue; }
    afterDma200++;

    // 4. Price >= 50
    const ETF_WHITELIST = new Set(['GOLDBEES', 'SILVERBEES']);
    if (currentClose < PARAMS.minPrice && !ETF_WHITELIST.has(symbol)) { failPrice++; continue; }
    afterPrice++;

    // 5. ATH proximity (within 30%)
    let ath = athMap.get(symbol) ?? 0;
    for (let i = 0; i <= dateIdx; i++) if (highs[i] > ath) ath = highs[i];
    const proximity = ath > 0 ? currentClose / ath : 0;
    const withinATH = proximity >= (1 - PARAMS.athProximityPct / 100);
    if (!withinATH) { failATH++; continue; }
    afterATH++;

    // 6. Volume — median daily turnover >= 1 Cr
    const volWindow: number[] = [];
    for (let i = Math.max(0, dateIdx - PARAMS.volumeLookbackDays + 1); i <= dateIdx; i++) {
      volWindow.push(closes[i] * volumes[i]);
    }
    const medianTurnover = median(volWindow);
    if (medianTurnover < PARAMS.volumeThresholdCr * 1e7) { failVolume++; continue; }
    afterVolume++;

    // 7. Sharpe validity
    const closes12m = closes.slice(Math.max(0, dateIdx - 251), dateIdx + 1);
    const closes6m  = closes.slice(Math.max(0, dateIdx - 125), dateIdx + 1);
    const closes3m  = closes.slice(Math.max(0, effectiveIdx - 62), effectiveIdx + 1);
    const s12 = sharpeRatio(computeReturns(closes12m));
    const s6  = sharpeRatio(computeReturns(closes6m));
    const s3  = sharpeRatio(computeReturns(closes3m));
    if (!Number.isFinite(s12) || !Number.isFinite(s6) || !Number.isFinite(s3)) { failSharpe++; continue; }
    afterSharpe++;
  }

  const pct = (n: number, d: number) => d > 0 ? `${((n/d)*100).toFixed(1)}%` : '0%';
  const bar = (n: number, total: number, width = 30) => {
    const filled = Math.round((n / total) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  };

  console.log(`Universe: ${total} NSE_EQ stocks\n`);
  console.log('Filter                 Removed  Remaining  Passing');
  console.log('─'.repeat(60));

  const rows = [
    { name: 'Mcap < 1000 Cr',       fail: failMcap,    after: afterMcap    },
    { name: 'Insufficient history',  fail: failHistory,  after: afterHistory  },
    { name: 'Below 200 DMA',         fail: failDma200,   after: afterDma200   },
    { name: 'Price < ₹50',           fail: failPrice,    after: afterPrice    },
    { name: 'ATH > 30% away',        fail: failATH,      after: afterATH      },
    { name: 'Volume < 1 Cr/day',     fail: failVolume,   after: afterVolume   },
    { name: 'Invalid Sharpe',        fail: failSharpe,   after: afterSharpe   },
  ];

  let remaining = total;
  for (const r of rows) {
    const pctPass = pct(r.after, total);
    console.log(
      `${r.name.padEnd(22)} -${String(r.fail).padStart(4)}    ${String(r.after).padStart(4)}      ${pctPass.padStart(5)}  ${bar(r.after, total, 25)}`
    );
    remaining = r.after;
  }

  console.log('─'.repeat(60));
  console.log(`\n✅ Qualifying (ranked): ${afterSharpe} / ${total} (${pct(afterSharpe, total)})\n`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
