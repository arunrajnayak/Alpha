import { defineConfig } from '@prisma/config';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// Load .env.local if it exists
const envLocalPath = join(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
// Also load .env as fallback
dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL?.startsWith('libsql')
      ? 'file:./dev.db'
      : process.env.DATABASE_URL,
  },
});
