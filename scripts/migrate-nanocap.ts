/**
 * Standalone migration script to add Nanocap columns to existing databases.
 * Usage: npx tsx scripts/migrate-nanocap.ts
 */

import { config } from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';
import { createClient } from '@libsql/client';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}
config();

const rawUrl = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
if (!rawUrl) {
  console.error('❌ DATABASE_URL or TURSO_DATABASE_URL is required in .env or .env.local');
  process.exit(1);
}

let cleanUrl = rawUrl.trim().replace(/^["']|["']$/g, '');
if (/^libsql:\/\//i.test(cleanUrl)) {
  cleanUrl = cleanUrl.replace(/^libsql:\/\//i, 'https://');
}

const client = createClient({
  url: cleanUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🚀 Running Nanocap schema migration on:', cleanUrl);

  const steps = [
    {
      name: 'WeeklyPortfolioSnapshot.nanoCapPercent',
      sql: 'ALTER TABLE "WeeklyPortfolioSnapshot" ADD COLUMN "nanoCapPercent" REAL;',
    },
    {
      name: 'MonthlyPortfolioSnapshot.nanoCapPercent',
      sql: 'ALTER TABLE "MonthlyPortfolioSnapshot" ADD COLUMN "nanoCapPercent" REAL;',
    },
    {
      name: 'IntradayMarketBreadth.nanoAdv',
      sql: 'ALTER TABLE "IntradayMarketBreadth" ADD COLUMN "nanoAdv" INTEGER;',
    },
    {
      name: 'IntradayMarketBreadth.nanoDec',
      sql: 'ALTER TABLE "IntradayMarketBreadth" ADD COLUMN "nanoDec" INTEGER;',
    },
  ];

  for (const step of steps) {
    try {
      await client.execute(step.sql);
      console.log(`✅ Added column: ${step.name}`);
    } catch (err: any) {
      if (err.message?.includes('duplicate column name')) {
        console.log(`ℹ️  Column already exists: ${step.name}`);
      } else {
        console.warn(`⚠️  Warning for ${step.name}:`, err.message);
      }
    }
  }

  console.log('\n🎉 Nanocap schema migration completed successfully!');
  client.close();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
