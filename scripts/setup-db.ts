import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load env
const envLocalPath = join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
dotenv.config();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || !dbUrl.includes('libsql://')) {
  console.error('❌ Please set correct DATABASE_URL in .env.local starting with libsql://');
  process.exit(1);
}

async function main() {
  try {
    // 1. Generate schema SQL
    console.log('⏳ Generating schema SQL from Prisma...');
    cp.execSync('npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/setup.sql', { stdio: 'inherit' });

    // 2. Read SQL
    const sql = fs.readFileSync('prisma/setup.sql', 'utf8');

    // 3. Connect to Turso
    console.log('🔄 Connecting to Turso...');
    const parsedUrl = new URL(dbUrl as string);
    const authToken = parsedUrl.searchParams.get('authToken') ?? process.env.TURSO_AUTH_TOKEN;
    
    parsedUrl.searchParams.delete('authToken');
    parsedUrl.searchParams.delete('sslmode');
    
    const client = createClient({
      url: parsedUrl.toString(),
      authToken,
    });

    // 4. Execute SQL
    console.log('🚀 Applying schema to Turso database...');
    
    // Split the SQL file into individual statements to execute them
    // executeMultiple in @libsql/client sometimes has limits, so we run them sequentially
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
      
    for (const stmt of statements) {
      await client.execute(stmt);
    }

    console.log('✅ Successfully pushed schema to Turso database!');
    
    // Cleanup
    if (fs.existsSync('prisma/setup.sql')) {
      fs.unlinkSync('prisma/setup.sql');
    }
    
    // Generate Prisma Client
    console.log('⏳ Generating Prisma Client...');
    cp.execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('✅ Done!');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error applying schema:', err);
    process.exit(1);
  }
}

main();
