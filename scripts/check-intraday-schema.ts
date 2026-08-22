import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await client.execute("PRAGMA table_info('IntradayPnL')");
  console.log(r.rows.map((row: any) => `${row.name} ${row.type} default=${row.dflt_value}`).join('\n'));
  client.close();
}

main().catch(console.error);
