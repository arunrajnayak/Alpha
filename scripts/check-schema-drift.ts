/**
 * Compares prisma/schema.prisma models against the live Turso/libSQL database
 * and reports any missing tables or missing columns (schema drift).
 *
 * Read-only: this script does NOT modify the database. Use it to see what
 * `ALTER TABLE` statements are needed to bring the DB in line with the schema.
 *
 * Usage: npx tsx scripts/check-schema-drift.ts
 */

import { config } from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';
import { createClient } from '@libsql/client';

const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) config({ path: envLocalPath });
config();

const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('❌ DATABASE_URL (or TURSO_DATABASE_URL) is not set.');
  process.exit(1);
}

const SCALAR_TYPES = new Set([
  'Int', 'BigInt', 'Float', 'Decimal', 'String', 'Boolean',
  'DateTime', 'Bytes', 'Json',
]);

interface Model {
  name: string;
  columns: string[]; // scalar column names only
}

function parseSchema(schemaPath: string): Model[] {
  const src = fs.readFileSync(schemaPath, 'utf-8');
  const models: Model[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = modelRegex.exec(src)) !== null) {
    const name = m[1];
    const body = m[2];
    const columns: string[] = [];
    for (const rawLine of body.split('\n')) {
      // Strip inline comments and whitespace
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;
      const parts = line.split(/\s+/);
      const fieldName = parts[0];
      const fieldType = parts[1];
      if (!fieldName || !fieldType) continue;
      const baseType = fieldType.replace(/[?[\]]/g, ''); // strip ? and []
      // Only scalar (non-relation) fields map to physical columns
      if (SCALAR_TYPES.has(baseType)) columns.push(fieldName);
    }
    models.push({ name, columns });
  }
  return models;
}

async function main() {
  const client = createClient({ url: url!, authToken: process.env.TURSO_AUTH_TOKEN });
  const models = parseSchema(join(process.cwd(), 'prisma/schema.prisma'));

  console.log(`🔍 Checking ${models.length} models against ${url}\n`);

  const alterStatements: string[] = [];
  let issues = 0;

  for (const model of models) {
    const info = await client.execute(`PRAGMA table_info("${model.name}")`);
    if (info.rows.length === 0) {
      console.log(`❌ TABLE MISSING: ${model.name}`);
      issues++;
      continue;
    }
    const dbCols = new Set(info.rows.map((r) => String(r.name)));
    const missing = model.columns.filter((c) => !dbCols.has(c));
    if (missing.length > 0) {
      console.log(`⚠️  ${model.name}: missing column(s) -> ${missing.join(', ')}`);
      missing.forEach((c) =>
        alterStatements.push(`-- ${model.name}.${c}`)
      );
      issues++;
    }
  }

  if (issues === 0) {
    console.log('✅ No drift detected. DB matches schema.prisma.');
  } else {
    console.log(`\n⚠️  ${issues} table(s) with drift. See details above.`);
  }
  client.close();
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
