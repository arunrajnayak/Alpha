import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'provider', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "provider" TEXT NOT NULL DEFAULT \'rss\'' },
    { name: 'authConfig', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "authConfig" TEXT' },
  ];

  for (const col of columns) {
    try {
      await client.execute(col.ddl);
      console.log(`✅ Added column ${col.name}`);
    } catch (err: any) {
      console.log(`• ${col.name}: ${err.message}`);
    }
  }

  const r = await client.execute("PRAGMA table_info('RadarNewsSource')");
  console.log('\nColumns:');
  console.log(r.rows.map((row: any) => `  ${row.name} ${row.type} default=${row.dflt_value}`).join('\n'));
  client.close();
}

main().catch(console.error);
