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

if (!TURSO_URL || !TURSO_URL.startsWith('libsql')) {
  console.error('❌ DATABASE_URL (or TURSO_DATABASE_URL) must point to a libsql:// Turso database');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

/**
 * Splits a Prisma-generated SQLite migration file into individual statements.
 * These migrations only use `;` as a statement terminator and never embed
 * semicolons inside string literals, so a simple split is safe here. We strip
 * `-- ...` and block comments first so empty/comment-only fragments are dropped.
 */
function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^\s*--.*$/gm, '');       // line comments

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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

      // Try the fast path first: executeMultiple runs the whole file in one shot.
      // It stops at the FIRST failing statement, though — which is a problem for
      // idempotent re-runs where some statements (e.g. `DROP INDEX` for an index
      // that no longer exists) fail even though the important `CREATE TABLE`
      // statements later in the file must still run. So on any failure we fall
      // back to executing the file statement-by-statement, skipping ones that
      // error (already applied / not applicable) and continuing with the rest.
      try {
        await client.executeMultiple(sqlContent);
        console.log(`✅ Applied migration ${folder} successfully.`);
      } catch (err: any) {
        console.warn(`⚠️  executeMultiple failed for ${folder}: ${err.message}`);
        console.log('   Falling back to statement-by-statement execution...');

        const statements = splitSqlStatements(sqlContent);
        let applied = 0;
        let skipped = 0;
        for (const stmt of statements) {
          try {
            await client.execute(stmt);
            applied++;
          } catch (stmtErr: any) {
            skipped++;
            const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
            console.warn(`   ⏭️  Skipped (${stmtErr.message}): ${preview}...`);
          }
        }
        console.log(`   ✅ ${folder}: ${applied} statement(s) applied, ${skipped} skipped.`);
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
