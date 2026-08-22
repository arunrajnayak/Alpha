/**
 * Diagnostic: prints the current portfolio holdings exactly as the live
 * dashboard / heatmap computes them (engine.holdings filtered by qty > 0.01),
 * alongside resolved BUY vs SELL quantity totals per symbol. This reveals any
 * "sold" stocks that leak in due to residual quantity (buy/sell mismatch,
 * symbol renames, splits, etc.).
 *
 * Read-only. Usage: npx tsx scripts/diagnose-holdings.ts
 */

import { config } from 'dotenv';
config();

import { createClient } from '@libsql/client';
import { PortfolioEngine, orderTransactionsForReplay } from '../src/lib/portfolio-engine';

// Toggle: set REPLAY_FIX=0 to see the buggy (unordered) result for comparison.
const APPLY_FIX = process.env.REPLAY_FIX !== '0';

// Mirror of getSymbolResolver (src/lib/amfi/service.ts) without server-only deps.
function stripSeriesSuffix(symbol: string): string {
  return symbol.replace(/-(BE|BZ|SM|ST)$/i, '').trim();
}
function makeResolver(mappings: { oldSymbol: string; newSymbol: string }[]) {
  const map = new Map<string, string>();
  for (const m of mappings) {
    map.set(stripSeriesSuffix(m.oldSymbol.toUpperCase().trim()), stripSeriesSuffix(m.newSymbol.toUpperCase().trim()));
  }
  return (symbol: string) => {
    let current = stripSeriesSuffix(symbol.toUpperCase().trim());
    const visited = new Set<string>();
    while (map.has(current) && !visited.has(current)) {
      visited.add(current);
      const next = map.get(current);
      if (!next) break;
      current = stripSeriesSuffix(next);
    }
    return current;
  };
}

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const txRes = await client.execute('SELECT date, symbol, type, quantity, price, splitRatio, newSymbol FROM "Transaction" ORDER BY date ASC');
  const mapRes = await client.execute('SELECT oldSymbol, newSymbol FROM "SymbolMapping"');

  const resolveSymbol = makeResolver(mapRes.rows.map(r => ({ oldSymbol: String(r.oldSymbol), newSymbol: String(r.newSymbol) })));
  const engine = new PortfolioEngine();

  const buyQty = new Map<string, number>();
  const sellQty = new Map<string, number>();

  let txns = txRes.rows.map(r => ({
    symbol: resolveSymbol(String(r.symbol)),
    type: String(r.type),
    quantity: Number(r.quantity),
    price: Number(r.price),
    date: new Date(String(r.date)),
    splitRatio: r.splitRatio != null ? Number(r.splitRatio) : null,
    newSymbol: r.newSymbol != null ? String(r.newSymbol) : null,
  }));

  if (APPLY_FIX) txns = orderTransactionsForReplay(txns);
  console.log(`Replay ordering fix: ${APPLY_FIX ? 'ON' : 'OFF'}`);

  for (const tx of txns) {
    if (tx.type === 'BUY') buyQty.set(tx.symbol, (buyQty.get(tx.symbol) ?? 0) + tx.quantity);
    if (tx.type === 'SELL') sellQty.set(tx.symbol, (sellQty.get(tx.symbol) ?? 0) + tx.quantity);
    engine.processTransaction(tx);
  }

  console.log(`\nTotal transactions: ${txRes.rows.length}`);
  console.log(`Engine holdings map size (incl. zero): ${engine.holdings.size}\n`);

  const active = [...engine.holdings.values()].filter(h => h.qty > 0.01).sort((a, b) => a.symbol.localeCompare(b.symbol));

  console.log(`=== ACTIVE holdings shown on heatmap (qty > 0.01): ${active.length} ===`);
  console.log('SYMBOL'.padEnd(14), 'ENGINE_QTY'.padStart(12), 'BUY'.padStart(10), 'SELL'.padStart(10), 'NET(B-S)'.padStart(10), '  FLAG');
  let leaks = 0;
  for (const h of active) {
    const b = buyQty.get(h.symbol) ?? 0;
    const s = sellQty.get(h.symbol) ?? 0;
    const net = b - s;
    const flag = Math.abs(net) < 0.01 ? '  <== SOLD-LEAK (net~0)'
      : Math.abs(net - h.qty) > 0.01 ? '  <== MISMATCH vs raw net'
      : '';
    if (flag) leaks++;
    console.log(h.symbol.padEnd(14), h.qty.toFixed(2).padStart(12), b.toFixed(2).padStart(10), s.toFixed(2).padStart(10), net.toFixed(2).padStart(10), flag);
  }

  console.log(`\nFlagged suspicious holdings: ${leaks}`);
  client.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
