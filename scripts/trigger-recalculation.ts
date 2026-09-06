/**
 * Standalone script to trigger portfolio recalculation against Turso.
 * 
 * Usage: npx tsx scripts/trigger-recalculation.ts [YYYY-MM-DD]
 */

// Force UTC timezone so local execution matches production Vercel server environment exactly
process.env.TZ = 'UTC';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Module = require('module');
const _orig = Module._load;
Module._load = function (req: string, parent: any, isMain: boolean) {
  if (req === 'server-only') return {};
  if (req === 'next/cache') return { unstable_cache: (fn: any) => fn, revalidateTag: () => {}, revalidatePath: () => {} };
  if (req === 'next/server') return {};
  return _orig(req, parent, isMain);
};

import { config } from 'dotenv';
import { join } from 'path';
import * as fs from 'fs';

const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}
config();

async function main() {
  const { recalculatePortfolioHistory } = await import('../src/lib/finance');

  const argDate = process.argv[2];
  const fromDate = argDate ? new Date(argDate) : undefined;

  console.log(`🚀 Starting portfolio recalculation${fromDate ? ` from ${fromDate.toISOString().slice(0, 10)}` : ' (full portfolio history)'}...`);
  
  const startTime = Date.now();
  await recalculatePortfolioHistory(fromDate, (msg, progress) => {
    if (progress % 10 === 0 || progress === 100) {
      console.log(`[${progress}%] ${msg}`);
    }
  });

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`✅ Recalculation finished successfully in ${durationSec}s!`);
}

main().catch(err => {
  console.error('❌ Recalculation failed:', err);
  process.exit(1);
});
