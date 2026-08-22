import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const total = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  console.log('Total Transaction rows:', (total.rows[0] as any).c);

  const distinct = await client.execute('SELECT COUNT(DISTINCT symbol) AS c FROM "Transaction"');
  console.log('Distinct symbols:', (distinct.rows[0] as any).c);

  const byType = await client.execute('SELECT type, COUNT(*) AS c FROM "Transaction" GROUP BY type');
  console.log('By type:', byType.rows.map((r: any) => `${r.type}=${r.c}`).join(', '));

  // Net quantity per symbol (BUY positive, SELL negative), show open positions
  const net = await client.execute(`
    SELECT symbol,
      SUM(CASE WHEN UPPER(type)='BUY' THEN quantity ELSE -quantity END) AS netQty
    FROM "Transaction"
    GROUP BY symbol
    HAVING netQty > 0.0000001
    ORDER BY netQty DESC
  `);
  console.log(`\nOpen positions (netQty > 0): ${net.rows.length}`);
  console.log(net.rows.slice(0, 10).map((r: any) => `  ${r.symbol}: ${r.netQty}`).join('\n'));

  const dateRange = await client.execute('SELECT MIN(date) AS mn, MAX(date) AS mx FROM "Transaction"');
  console.log('\nDate range:', (dateRange.rows[0] as any).mn, '→', (dateRange.rows[0] as any).mx);

  client.close();
}

main().catch(console.error);
