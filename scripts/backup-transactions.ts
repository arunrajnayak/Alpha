import { config } from 'dotenv';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const s = stamp();

  // 1) Local JSON backup
  const rows = await client.execute('SELECT * FROM "Transaction" ORDER BY id ASC');
  const backupDir = join(process.cwd(), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `Transaction_backup_${s}.json`);
  writeFileSync(file, JSON.stringify(rows.rows, null, 2));
  console.log(`Local JSON backup: ${file}`);
  console.log(`Rows backed up: ${rows.rows.length}`);

  // 2) In-DB backup table (full copy)
  const tableName = `Transaction_backup_${s}`;
  await client.execute(`CREATE TABLE "${tableName}" AS SELECT * FROM "Transaction"`);
  const cnt = await client.execute(`SELECT COUNT(*) AS c FROM "${tableName}"`);
  console.log(`\nDB backup table created: "${tableName}"  rows=${(cnt.rows[0] as any).c}`);

  client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
