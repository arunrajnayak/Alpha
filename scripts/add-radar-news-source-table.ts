import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS "RadarNewsSource" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "domain" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS "RadarNewsSource_domain_key" ON "RadarNewsSource"("domain")');
    await client.execute('CREATE INDEX IF NOT EXISTS "RadarNewsSource_createdAt_idx" ON "RadarNewsSource"("createdAt")');
    console.log('✅ RadarNewsSource table + indexes ready.');
  } catch (err: any) {
    console.log('Result:', err.message);
  }
  const r = await client.execute("PRAGMA table_info('RadarNewsSource')");
  console.log('\nColumns:');
  console.log(r.rows.map((row: any) => `  ${row.name} ${row.type} default=${row.dflt_value}`).join('\n'));
  client.close();
}

main().catch(console.error);
