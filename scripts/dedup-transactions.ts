import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const before = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  const beforeCount = (before.rows[0] as any).c as number;
  const groups = await client.execute(
    'SELECT COUNT(*) AS c FROM (SELECT 1 FROM "Transaction" GROUP BY symbol, date, type)'
  );
  const groupCount = (groups.rows[0] as any).c as number;
  console.log(`Before: ${beforeCount} rows, ${groupCount} unique (symbol,date,type) groups`);
  console.log(`Will delete: ${beforeCount - groupCount} duplicate rows\n`);

  // Keep the earliest (MIN id) row for each (symbol, date, type) group.
  const res = await client.execute(`
    DELETE FROM "Transaction"
    WHERE id NOT IN (
      SELECT MIN(id) FROM "Transaction" GROUP BY symbol, date, type
    )
  `);
  console.log(`Deleted ${res.rowsAffected} rows.`);

  const after = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  console.log(`After: ${(after.rows[0] as any).c} rows`);

  // Verify no remaining duplicates
  const remaining = await client.execute(`
    SELECT COUNT(*) AS c FROM (
      SELECT symbol, date, type, COUNT(*) AS n FROM "Transaction"
      GROUP BY symbol, date, type HAVING n > 1
    )
  `);
  console.log(`Remaining duplicate groups: ${(remaining.rows[0] as any).c}`);

  // Quick sanity: open positions count
  const net = await client.execute(`
    SELECT COUNT(*) AS c FROM (
      SELECT symbol, SUM(CASE WHEN UPPER(type)='BUY' THEN quantity WHEN UPPER(type)='SELL' THEN -quantity ELSE 0 END) AS q
      FROM "Transaction" GROUP BY symbol HAVING q > 0.0001
    )
  `);
  console.log(`Open positions now: ${(net.rows[0] as any).c}`);

  client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
