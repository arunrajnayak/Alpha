import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const rows = await client.execute(
    'SELECT date FROM "DailyPortfolioSnapshot" ORDER BY date DESC LIMIT 6'
  );

  console.log('Latest 6 DailyPortfolioSnapshot.date (raw) + derived labels:\n');
  for (const r of rows.rows as any[]) {
    const raw = r.date as string;
    const d = new Date(raw);
    const utcPart = d.toISOString().split('T')[0]; // what checkMarketStatus uses
    const istPart = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD in IST
    const labelFromUtc = new Date(utcPart + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    const labelFromIst = new Date(istPart + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    console.log(`raw=${raw}`);
    console.log(`   UTC-part=${utcPart}  -> label "${labelFromUtc}"   (current code)`);
    console.log(`   IST-part=${istPart}  -> label "${labelFromIst}"   (IST-correct)`);
    console.log('');
  }

  console.log('Server TZ offset (getTimezoneOffset mins):', new Date().getTimezoneOffset());
  console.log('process.env.TZ =', process.env.TZ ?? '(unset)');

  client.close();
}

main().catch(console.error);
