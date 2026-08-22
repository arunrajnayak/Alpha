import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const columns = ['nifty50Percent', 'n500m50Percent'];
  for (const col of columns) {
    try {
      await client.execute(`ALTER TABLE "IntradayPnL" ADD COLUMN "${col}" REAL`);
      console.log(`✅ Column ${col} added successfully.`);
    } catch (err: any) {
      console.log(`Result for ${col}:`, err.message);
    }
  }
  const r = await client.execute("PRAGMA table_info('IntradayPnL')");
  console.log('\nColumns:');
  console.log(r.rows.map((row: any) => `  ${row.name} ${row.type} default=${row.dflt_value}`).join('\n'));
  client.close();
}

main().catch(console.error);
