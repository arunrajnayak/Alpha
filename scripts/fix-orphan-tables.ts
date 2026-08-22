/**
 * Repairs an interrupted SQLite table-rebuild migration on the Turso DB.
 *
 * Symptom: `Transaction` and `WeeklyPortfolioSnapshot` are missing, while the
 * orphaned rebuild tables `new_Transaction` / `new_WeeklyPortfolioSnapshot`
 * (holding the real data) remain. This renames them back to their proper names
 * and recreates the indexes/unique constraints defined in schema.prisma.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function tableExists(client: ReturnType<typeof createClient>, name: string) {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function run(client: ReturnType<typeof createClient>, sql: string) {
  try {
    await client.execute(sql);
    console.log('✅', sql);
  } catch (err: any) {
    console.log('⚠️ ', sql, '\n     →', err.message);
  }
}

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const renames: Array<[string, string]> = [
    ['new_Transaction', 'Transaction'],
    ['new_WeeklyPortfolioSnapshot', 'WeeklyPortfolioSnapshot'],
  ];

  for (const [from, to] of renames) {
    const fromExists = await tableExists(client, from);
    const toExists = await tableExists(client, to);
    if (toExists) {
      console.log(`⏭  "${to}" already exists — skipping rename of "${from}".`);
      continue;
    }
    if (!fromExists) {
      console.log(`⏭  "${from}" not found — nothing to rename.`);
      continue;
    }
    await run(client, `ALTER TABLE "${from}" RENAME TO "${to}"`);
  }

  // Recreate indexes / unique constraints from schema.prisma (idempotent).
  await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_orderId_key" ON "Transaction"("orderId")`);
  await run(client, `CREATE INDEX IF NOT EXISTS "Transaction_date_idx" ON "Transaction"("date")`);
  await run(client, `CREATE INDEX IF NOT EXISTS "Transaction_date_symbol_idx" ON "Transaction"("date", "symbol")`);
  await run(client, `CREATE INDEX IF NOT EXISTS "Transaction_type_idx" ON "Transaction"("type")`);
  await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyPortfolioSnapshot_date_key" ON "WeeklyPortfolioSnapshot"("date")`);

  // Verify
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Transaction','WeeklyPortfolioSnapshot','new_Transaction','new_WeeklyPortfolioSnapshot') ORDER BY name");
  console.log('\nFinal state:', tables.rows.map((r: any) => r.name).join(', ') || '(none)');

  client.close();
}

main().catch(console.error);
