import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  // Distinct dates present in the recent window, with row counts
  const rows = await client.execute(`
    SELECT date, COUNT(*) AS c
    FROM "StockHistory"
    WHERE date >= '2026-08-14'
    GROUP BY date
    ORDER BY date DESC
  `);

  console.log('Recent distinct StockHistory dates (raw) + weekday:\n');
  for (const r of rows.rows as any[]) {
    const raw = r.date as string;
    const d = new Date(raw);
    const wdUtc = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const wdIst = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    const utcPart = d.toISOString().split('T')[0];
    console.log(`raw=${raw}  rows=${r.c}  | UTC ${utcPart} (${wdUtc})  IST-weekday ${wdIst}`);
  }

  client.close();
}

main().catch(console.error);
