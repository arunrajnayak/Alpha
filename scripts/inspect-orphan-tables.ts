import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  for (const t of ['Transaction', 'new_Transaction', 'WeeklyPortfolioSnapshot', 'new_WeeklyPortfolioSnapshot']) {
    const exists = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [t],
    });
    if (exists.rows.length === 0) {
      console.log(`\n=== ${t}: DOES NOT EXIST ===`);
      continue;
    }
    const count = await client.execute(`SELECT COUNT(*) AS c FROM "${t}"`);
    const info = await client.execute(`PRAGMA table_info('${t}')`);
    console.log(`\n=== ${t}: ${(count.rows[0] as any).c} rows ===`);
    console.log(info.rows.map((row: any) => `  ${row.name} ${row.type}`).join('\n'));
  }

  client.close();
}

main().catch(console.error);
