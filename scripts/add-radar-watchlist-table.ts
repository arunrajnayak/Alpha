import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS "RadarWatchlist" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "symbol" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS "RadarWatchlist_symbol_key" ON "RadarWatchlist"("symbol")');
    await client.execute('CREATE INDEX IF NOT EXISTS "RadarWatchlist_createdAt_idx" ON "RadarWatchlist"("createdAt")');
    console.log('✅ RadarWatchlist table + indexes ready.');
  } catch (err: any) {
    console.log('Result:', err.message);
  }
  const r = await client.execute("PRAGMA table_info('RadarWatchlist')");
  console.log('\nColumns:');
  console.log(r.rows.map((row: any) => `  ${row.name} ${row.type} default=${row.dflt_value}`).join('\n'));
  client.close();
}

main().catch(console.error);
