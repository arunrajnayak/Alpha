// Force UTC timezone so local execution matches production Vercel server environment exactly
process.env.TZ = 'UTC';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envLocalPath = path.resolve(__dirname, '../../.env.local');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Module = require('module');
const _orig = Module._load;

Module._load = function(req: string, parent: any, isMain: boolean) {
  if (req === 'server-only') return {};
  if (req === 'next/cache') return { unstable_cache: (fn: any) => fn, revalidateTag: () => {}, revalidatePath: () => {} };
  if (req === 'next/server') return {};
  return _orig(req, parent, isMain);
};

async function main() {
  const { runScreenerPipeline } = await import('../lib/screener/pipeline');
  const { prisma } = await import('../lib/db');
  const targetDate = process.argv[2];
  console.log(`Starting screener pipeline${targetDate ? ` for target date: ${targetDate}` : ''}...`);
  const t0 = Date.now();
  const res = await runScreenerPipeline(undefined, undefined, targetDate);
  console.log('Result:', JSON.stringify(res, null, 2));
  console.log(`Pipeline finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
