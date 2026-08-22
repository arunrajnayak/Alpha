import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'isPrivate', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT 0' },
    { name: 'authToken', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "authToken" TEXT' },
    { name: 'authUser', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "authUser" TEXT' },
    { name: 'authPass', ddl: 'ALTER TABLE "RadarNewsSource" ADD COLUMN "authPass" TEXT' },
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
