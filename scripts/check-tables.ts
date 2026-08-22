import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('Tables in DB:');
  console.log(r.rows.map((row: any) => `  ${row.name}`).join('\n'));
  client.close();
}

main().catch(console.error);
