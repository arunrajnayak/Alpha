import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Aug 22, 2026 is a Saturday — NSE is closed on weekends, so these rows are bogus.
const PHANTOM_DATE = '2026-08-22T00:00:00.000+00:00';

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const before = await client.execute({
    sql: 'SELECT COUNT(*) AS c FROM "StockHistory" WHERE date = ?',
    args: [PHANTOM_DATE],
  });
  const count = (before.rows[0] as any).c as number;
  console.log(`Phantom Saturday (2026-08-22) StockHistory rows: ${count}`);

  if (count === 0) {
    console.log('Nothing to delete.');
    client.close();
    return;
  }

  const res = await client.execute({
    sql: 'DELETE FROM "StockHistory" WHERE date = ?',
    args: [PHANTOM_DATE],
  });
  console.log(`Deleted ${res.rowsAffected} rows.`);

  const after = await client.execute(`
    SELECT date, COUNT(*) AS c FROM "StockHistory"
    WHERE date >= '2026-08-18' GROUP BY date ORDER BY date DESC
  `);
  console.log('\nRemaining recent StockHistory dates:');
  for (const r of after.rows as any[]) {
    const wd = new Date(r.date as string).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    console.log(`  ${(r.date as string).split('T')[0]} (${wd})  rows=${r.c}`);
  }

  client.close();
}

main().catch(console.error);
