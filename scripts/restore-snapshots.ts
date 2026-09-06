/**
 * Restore snapshot tables (DailyPortfolioSnapshot, WeeklyPortfolioSnapshot, MonthlyPortfolioSnapshot)
 * from a JSON backup file to Turso database.
 * 
 * Usage: npx tsx scripts/restore-snapshots.ts <path-to-backup-json>
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

const backupFile = process.argv[2];
if (!backupFile || !fs.existsSync(backupFile)) {
  console.error('❌ Usage: npx tsx scripts/restore-snapshots.ts <path-to-backup.json>');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log(`🔄 Reading backup file: ${backupFile}`);
  const data = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));

  console.log(`📦 Backup contains:`);
  console.log(`   - Daily snapshots:   ${data.daily?.length ?? 0}`);
  console.log(`   - Weekly snapshots:  ${data.weekly?.length ?? 0}`);
  console.log(`   - Monthly snapshots: ${data.monthly?.length ?? 0}`);

  console.log('⚠️  Restoring will overwrite existing snapshot tables in Turso.');

  // Clean existing snapshots
  await client.execute('DELETE FROM DailyPortfolioSnapshot');
  await client.execute('DELETE FROM WeeklyPortfolioSnapshot');
  await client.execute('DELETE FROM MonthlyPortfolioSnapshot');
  console.log('🧹 Cleared existing snapshot tables.');

  // Restore Daily
  if (data.daily && data.daily.length > 0) {
    const cols = Object.keys(data.daily[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO DailyPortfolioSnapshot (${colList}) VALUES (${placeholders})`;

    const batches = chunkArray(data.daily, 50);
    for (const batch of batches) {
      const stmts = batch.map((row: any) => ({
        sql,
        args: cols.map(c => row[c] ?? null),
      }));
      await client.batch(stmts, 'write');
    }
    console.log(`✅ Restored ${data.daily.length} DailyPortfolioSnapshot rows.`);
  }

  // Restore Weekly
  if (data.weekly && data.weekly.length > 0) {
    const cols = Object.keys(data.weekly[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO WeeklyPortfolioSnapshot (${colList}) VALUES (${placeholders})`;

    const batches = chunkArray(data.weekly, 50);
    for (const batch of batches) {
      const stmts = batch.map((row: any) => ({
        sql,
        args: cols.map(c => row[c] ?? null),
      }));
      await client.batch(stmts, 'write');
    }
    console.log(`✅ Restored ${data.weekly.length} WeeklyPortfolioSnapshot rows.`);
  }

  // Restore Monthly
  if (data.monthly && data.monthly.length > 0) {
    const cols = Object.keys(data.monthly[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO MonthlyPortfolioSnapshot (${colList}) VALUES (${placeholders})`;

    const batches = chunkArray(data.monthly, 50);
    for (const batch of batches) {
      const stmts = batch.map((row: any) => ({
        sql,
        args: cols.map(c => row[c] ?? null),
      }));
      await client.batch(stmts, 'write');
    }
    console.log(`✅ Restored ${data.monthly.length} MonthlyPortfolioSnapshot rows.`);
  }

  console.log('🎉 Restore complete!');
}

main().catch(err => {
  console.error('❌ Restore failed:', err);
  process.exit(1);
});
