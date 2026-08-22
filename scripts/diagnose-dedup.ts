import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const total = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  console.log('Total rows:', (total.rows[0] as any).c);

  // Groups by (symbol,date,type) — the importer's consolidation key
  const g = await client.execute(`
    SELECT symbol, date, type,
      COUNT(*) AS c,
      COUNT(DISTINCT quantity) AS qv,
      COUNT(DISTINCT price) AS pv
    FROM "Transaction"
    GROUP BY symbol, date, type
  `);
  let groups = 0, dupGroups = 0, groupsWithVaryingQty = 0, groupsWithVaryingPrice = 0, extraRows = 0;
  for (const r of g.rows as any[]) {
    groups++;
    if (r.c > 1) { dupGroups++; extraRows += (r.c - 1); }
    if (r.qv > 1) groupsWithVaryingQty++;
    if (r.pv > 1) groupsWithVaryingPrice++;
  }
  console.log(`\nUnique (symbol,date,type) groups: ${groups}`);
  console.log(`Groups with duplicates (c>1): ${dupGroups}`);
  console.log(`Extra rows if we keep 1 per group: ${extraRows}`);
  console.log(`=> Clean transaction count would be: ${groups}`);
  console.log(`\nGroups where quantity VARIES within group: ${groupsWithVaryingQty}`);
  console.log(`Groups where price VARIES within group: ${groupsWithVaryingPrice}`);
  console.log('(If these are ~0, duplicates are exact copies => safe to dedup by symbol/date/type)');

  // Simulate deduped net open positions & value
  const net = await client.execute(`
    WITH dedup AS (
      SELECT symbol, date, type, quantity, price
      FROM "Transaction"
      GROUP BY symbol, date, type
    )
    SELECT symbol,
      SUM(CASE WHEN UPPER(type)='BUY' THEN quantity WHEN UPPER(type)='SELL' THEN -quantity ELSE 0 END) AS netQty
    FROM dedup
    GROUP BY symbol
    HAVING netQty > 0.0001
  `);
  const prices = await client.execute(`SELECT symbol, close FROM "StockHistory" WHERE date = (SELECT MAX(date) FROM "StockHistory")`);
  const pm = new Map<string, number>();
  for (const r of prices.rows as any[]) pm.set(r.symbol, r.close);

  let val = 0; let invested = 0;
  // Also compute invested (book cost) with dedup via FIFO-ish average using dedup rows
  const buys = await client.execute(`
    WITH dedup AS (SELECT symbol, date, type, quantity, price FROM "Transaction" GROUP BY symbol, date, type)
    SELECT symbol,
      SUM(CASE WHEN UPPER(type)='BUY' THEN quantity*price ELSE 0 END) AS buyVal,
      SUM(CASE WHEN UPPER(type)='BUY' THEN quantity ELSE 0 END) AS buyQty,
      SUM(CASE WHEN UPPER(type)='SELL' THEN quantity ELSE 0 END) AS sellQty
    FROM dedup GROUP BY symbol
  `);
  const buyMap = new Map<string, any>();
  for (const r of buys.rows as any[]) buyMap.set(r.symbol, r);

  for (const r of net.rows as any[]) {
    const p = pm.get(r.symbol) ?? 0;
    val += (r.netQty as number) * p;
    const b = buyMap.get(r.symbol);
    if (b && b.buyQty > 0) {
      const avg = b.buyVal / b.buyQty;
      invested += (r.netQty as number) * avg;
    }
  }
  console.log(`\n--- After dedup (estimated) ---`);
  console.log(`Open positions: ${net.rows.length}`);
  console.log(`Estimated current value: Rs ${val.toFixed(2)}`);
  console.log(`Estimated invested (avg-cost x netQty): Rs ${invested.toFixed(2)}`);

  client.close();
}

main().catch(console.error);
