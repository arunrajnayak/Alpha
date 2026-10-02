/**
 * Script to apply all Prisma migrations to a Turso database using @libsql/client.
 * Usage: npx tsx scripts/apply-turso-schema.ts
 */

import { config } from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';
import { createClient } from '@libsql/client';

// Load env
const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}
config();

// DATABASE_URL is the canonical name. TURSO_DATABASE_URL is injected automatically
// by the Vercel Marketplace Turso integration — both are accepted.
const TURSO_URL = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.error('❌ DATABASE_URL (or TURSO_DATABASE_URL) must point to a Turso database');
  process.exit(1);
}

let cleanUrl = TURSO_URL.trim().replace(/^["']|["']$/g, '');
if (/^libsql:\/\//i.test(cleanUrl)) {
  cleanUrl = cleanUrl.replace(/^libsql:\/\//i, 'https://');
}

const client = createClient({
  url: cleanUrl,
  authToken: TURSO_TOKEN,
});

async function main() {
  try {
    console.log('🚀 Connecting to Turso:', TURSO_URL);

    // Get list of migration folders sorted by name
    const migrationsDir = join(process.cwd(), 'prisma/migrations');
    const folders = fs.readdirSync(migrationsDir)
      .filter(f => fs.statSync(join(migrationsDir, f)).isDirectory())
      .sort();

    console.log(`Found ${folders.length} migrations to check/apply.`);

    for (const folder of folders) {
      console.log(`\nChecking migration: ${folder} ...`);
      const sqlFile = join(migrationsDir, folder, 'migration.sql');
      if (!fs.existsSync(sqlFile)) {
        console.log(`⚠️  No migration.sql found in ${folder}, skipping.`);
        continue;
      }

      const sqlContent = fs.readFileSync(sqlFile, 'utf-8');

      // SQLite/libSQL doesn't support PRAGMA foreign_keys inside transactions sometimes,
      // but executeMultiple handles it well.
      try {
        await client.executeMultiple(sqlContent);
        console.log(`✅ Applied migration ${folder} successfully.`);
      } catch (err: any) {
        console.warn(`⚠️  Warning/Error applying ${folder}:`, err.message);
        console.log('Continuing...');
      }
    }

    console.log('\n✅ All migrations processed.');
    client.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error executing migrations:', err);
    client.close();
    process.exit(1);
  }
}

main();
