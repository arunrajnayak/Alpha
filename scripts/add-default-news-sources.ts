import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });

// New defaults to make sure exist on already-seeded installs.
const NEW_DOMAINS = ['timesofindia.indiatimes.com', 'cnbctv18.com'];

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  for (const domain of NEW_DOMAINS) {
    try {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO "RadarNewsSource" ("domain", "isPrivate") VALUES (?, 0)',
        args: [domain],
      });
      console.log(`✅ Ensured ${domain}`);
    } catch (err: any) {
      console.log(`• ${domain}: ${err.message}`);
    }
  }

  const r = await client.execute('SELECT domain FROM "RadarNewsSource" ORDER BY createdAt ASC');
  console.log('\nCurrent sources:');
  console.log(r.rows.map((row: any) => `  ${row.domain}`).join('\n'));
  client.close();
}

main().catch(console.error);
