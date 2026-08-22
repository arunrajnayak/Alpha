import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const total = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  console.log('Total Transaction rows:', (total.rows[0] as any).c);

  // Duplicate detection: same symbol/date/type/quantity/price appearing >1
  const dups = await client.execute(`
    SELECT symbol, date, type, quantity, price, COUNT(*) AS c
    FROM "Transaction"
    GROUP BY symbol, date, type, quantity, price
    HAVING c > 1
    ORDER BY c DESC
  `);
  const dupGroups = dups.rows.length;
  const dupExtra = (dups.rows as any[]).reduce((s, r) => s + (r.c - 1), 0);
  console.log(`\nDuplicate groups (same symbol/date/type/qty/price): ${dupGroups}`);
  console.log(`Extra duplicate rows (beyond first): ${dupExtra}`);
  console.log('Top duplicate groups:');
  console.log((dups.rows as any[]).slice(0, 8).map(r => `  ${r.symbol} ${String(r.date).split('T')[0]} ${r.type} q=${r.quantity} p=${r.price} x${r.c}`).join('\n'));

  // Duplicate by tradeId (should be globally unique in a Zerodha book)
  const dupTid = await client.execute(`
    SELECT tradeId, COUNT(*) AS c FROM "Transaction"
    WHERE tradeId IS NOT NULL AND tradeId <> ''
    GROUP BY tradeId HAVING c > 1
  `);
  console.log(`\nDuplicate tradeId groups: ${dupTid.rows.length}`);

  // Net open positions and estimated current value using latest StockHistory close
  const net = await client.execute(`
    SELECT t.symbol AS symbol,
      SUM(CASE WHEN UPPER(t.type)='BUY' THEN t.quantity WHEN UPPER(t.type)='SELL' THEN -t.quantity ELSE 0 END) AS netQty
    FROM "Transaction" t
    GROUP BY t.symbol
    HAVING netQty > 0.0001
  `);

  // Latest close per symbol
  const prices = await client.execute(`
    SELECT symbol, close FROM "StockHistory"
    WHERE date = (SELECT MAX(date) FROM "StockHistory")
  `);
  const priceMap = new Map<string, number>();
  for (const r of prices.rows as any[]) priceMap.set(r.symbol, r.close);
  const latestDate = await client.execute('SELECT MAX(date) AS d FROM "StockHistory"');
  console.log(`\nUsing StockHistory close date: ${String((latestDate.rows[0] as any).d).split('T')[0]}`);

  let estValue = 0;
  let priced = 0;
  for (const r of net.rows as any[]) {
    const p = priceMap.get(r.symbol);
    if (p != null) { estValue += (r.netQty as number) * p; priced++; }
  }
  console.log(`Open positions: ${net.rows.length} (priced: ${priced})`);
  console.log(`Estimated current value (netQty x latest close): Rs ${estValue.toFixed(2)}`);

  client.close();
}

main().catch(console.error);
