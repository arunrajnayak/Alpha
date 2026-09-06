/**
 * Backup snapshot tables (DailyPortfolioSnapshot, WeeklyPortfolioSnapshot, MonthlyPortfolioSnapshot)
 * from Turso database to a JSON file.
 * 
 * Usage: npx tsx scripts/backup-snapshots.ts [optional-output-filename]
 */

import { config } from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';
import { createClient } from '@libsql/client';

const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}
config();

const TURSO_URL = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.replace(/^libsql:\/\//i, 'https://');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.error('❌ DATABASE_URL or TURSO_DATABASE_URL not found');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

async function main() {
  console.log('🔄 Backing up snapshots from Turso...');
  
  const dailyRes = await client.execute('SELECT * FROM DailyPortfolioSnapshot ORDER BY date ASC');
  const weeklyRes = await client.execute('SELECT * FROM WeeklyPortfolioSnapshot ORDER BY date ASC');
  const monthlyRes = await client.execute('SELECT * FROM MonthlyPortfolioSnapshot ORDER BY date ASC');

  const backupData = {
    timestamp: new Date().toISOString(),
    counts: {
      daily: dailyRes.rows.length,
      weekly: weeklyRes.rows.length,
      monthly: monthlyRes.rows.length,
    },
    daily: dailyRes.rows,
    weekly: weeklyRes.rows,
    monthly: monthlyRes.rows,
  };

  const backupsDir = join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const filename = process.argv[2] || `snapshots_backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  const filePath = join(backupsDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

  console.log(`✅ Backup successfully saved to: ${filePath}`);
  console.log(`   - Daily snapshots:   ${dailyRes.rows.length}`);
  console.log(`   - Weekly snapshots:  ${weeklyRes.rows.length}`);
  console.log(`   - Monthly snapshots: ${monthlyRes.rows.length}`);
}

main().catch(err => {
  console.error('❌ Backup failed:', err);
  process.exit(1);
});
