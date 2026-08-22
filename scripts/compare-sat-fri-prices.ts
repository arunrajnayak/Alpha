import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const res = await client.execute(`
    SELECT fri.symbol AS symbol, fri.close AS friClose, sat.close AS satClose
    FROM "StockHistory" fri
    JOIN "StockHistory" sat
      ON fri.symbol = sat.symbol
    WHERE fri.date = '2026-08-21T00:00:00.000+00:00'
      AND sat.date = '2026-08-22T00:00:00.000+00:00'
    ORDER BY fri.symbol
  `);

  let identical = 0;
  let different = 0;
  const diffs: string[] = [];
  for (const r of res.rows as any[]) {
    if (Math.abs((r.friClose as number) - (r.satClose as number)) < 1e-9) identical++;
    else {
      different++;
      if (diffs.length < 8) diffs.push(`${r.symbol}: Fri=${r.friClose} Sat=${r.satClose}`);
    }
  }
  console.log(`Matched symbols: ${res.rows.length}`);
  console.log(`Identical Fri==Sat close: ${identical}`);
  console.log(`Different: ${different}`);
  if (diffs.length) console.log('Samples of different:\n  ' + diffs.join('\n  '));

  client.close();
}

main().catch(console.error);
