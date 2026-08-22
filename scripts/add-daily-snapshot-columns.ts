import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const info = await client.execute('PRAGMA table_info("DailyPortfolioSnapshot")');
  const existing = info.rows.map((r: any) => r.name as string);

  const toAdd = ['xirr', 'cagr'].filter((c) => !existing.includes(c));

  if (toAdd.length === 0) {
    console.log('Nothing to add — xirr and cagr already exist.');
    client.close();
    return;
  }

  for (const col of toAdd) {
    console.log(`Adding column "${col}" (REAL, nullable)...`);
    await client.execute(`ALTER TABLE "DailyPortfolioSnapshot" ADD COLUMN "${col}" REAL`);
  }

  const after = await client.execute('PRAGMA table_info("DailyPortfolioSnapshot")');
  console.log('\nDone. Columns now:');
  console.log('  ' + after.rows.map((r: any) => r.name).join(', '));

  client.close();
}

main().catch(console.error);
