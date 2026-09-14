/**
 * Check why STLTECH is missing from screener lists.
 * Uses Upstox API directly (no DB connection needed).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

const TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN;
if (!TOKEN) throw new Error('Missing UPSTOX_ANALYTICS_TOKEN');

const INSTRUMENT_KEY = 'NSE_EQ|INE089C01029'; // STLTECH

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log('=== STLTECH Screener Exclusion Diagnostic ===\n');

  // 1. Full quote — circuit limits
  console.log('1. Checking circuit limits (full quote)...');
  const quoteUrl = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(INSTRUMENT_KEY)}`;
  const quoteData = await fetchJSON(quoteUrl);
  const quote = Object.values(quoteData.data)[0] as any;
  if (quote) {
    const lower = quote.lower_circuit_limit;
    const upper = quote.upper_circuit_limit;
    const bandWidth = lower > 0 ? (upper - lower) / lower : 0;
    console.log(`  LTP: ₹${quote.last_price}`);
    console.log(`  Circuit: ₹${lower} — ₹${upper}`);
    console.log(`  Band width: ${(bandWidth * 100).toFixed(1)}%`);
    console.log(`  Filter (>=15%): ${bandWidth >= 0.15 ? 'PASS ✓' : 'FAIL ✗ — THIS EXCLUDES FROM BOTH LISTS'}`);
  }

  // 2. Historical candles — check data availability
  console.log('\n2. Checking candle data (last 18 months)...');
  const today = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 540 * 86400000).toISOString().split('T')[0]; // ~18m ago
  const candleUrl = `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(INSTRUMENT_KEY)}/days/1/${today}/${from}`;
  const candleData = await fetchJSON(candleUrl);
  const candles = candleData.data?.candles || [];
  console.log(`  Candles available: ${candles.length}`);
  console.log(`  Filter (>=248): ${candles.length >= 248 ? 'PASS ✓' : 'FAIL ✗ — NOT ENOUGH HISTORY'}`);
  if (candles.length > 0) {
    console.log(`  Date range: ${candles[candles.length - 1][0]?.split('T')[0]} → ${candles[0][0]?.split('T')[0]}`);
    const latestClose = candles[0][4]; // [ts, open, high, low, close, volume]
    const allHighs = candles.map((c: any) => c[2]);
    const ath = Math.max(...allHighs);
    const prox = latestClose / ath;
    console.log(`  Latest close: ₹${latestClose}`);
    console.log(`  ATH (from candles): ₹${ath}`);
    console.log(`  ATH proximity: ${(prox * 100).toFixed(2)}%`);
    console.log(`  ATH filter (>=70%): ${prox >= 0.70 ? 'PASS ✓' : 'FAIL ✗ — excluded from pre-filtered only'}`);
  }

  // 3. LTP for current state
  console.log('\n3. Current LTP...');
  const ltpUrl = `https://api.upstox.com/v3/market-quote/ltp?instrument_key=${encodeURIComponent(INSTRUMENT_KEY)}`;
  const ltpData = await fetchJSON(ltpUrl);
  const ltp = Object.values(ltpData.data)[0] as any;
  if (ltp) {
    console.log(`  LTP: ₹${ltp.last_price}`);
    console.log(`  Instrument: ${ltp.instrument_token || INSTRUMENT_KEY}`);
  }

  console.log('\n=== Summary ===');
  if (quote) {
    const lower = quote.lower_circuit_limit;
    const upper = quote.upper_circuit_limit;
    const bandWidth = lower > 0 ? (upper - lower) / lower : 0;
    if (bandWidth < 0.15) {
      console.log(`VERDICT: STLTECH is excluded because circuit band is ${(bandWidth*100).toFixed(1)}% (< 15% threshold).`);
      console.log(`This applies to BOTH pre-filtered and all lists (pipeline-level filter).`);
    } else if (candles.length < 248) {
      console.log(`VERDICT: STLTECH is excluded because only ${candles.length} candles available (< 248 needed).`);
    } else {
      console.log(`VERDICT: STLTECH passes circuit + candle filters. Issue may be in DB state.`);
    }
  }
}

main().catch(console.error);
