import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await client.execute(`
    SELECT date, totalEquity, investedCapital, portfolioNAV, units, xirr, cagr
    FROM "DailyPortfolioSnapshot" ORDER BY date DESC LIMIT 3
  `);
  for (const row of r.rows as any[]) {
    console.log(`${String(row.date).split('T')[0]}  equity=Rs ${Number(row.totalEquity).toFixed(0)}  invested=Rs ${Number(row.investedCapital).toFixed(0)}  NAV=${row.portfolioNAV}  xirr=${row.xirr ?? '-'}  cagr=${row.cagr ?? '-'}`);
  }
  const cnt = await client.execute('SELECT COUNT(*) AS c FROM "Transaction"');
  console.log(`\nTransaction rows: ${(cnt.rows[0] as any).c}`);
  client.close();
}
main().catch(console.error);
