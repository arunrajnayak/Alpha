import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@libsql/client';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

const EXPECTED = [
  'id', 'date', 'totalEquity', 'investedCapital', 'portfolioNAV', 'niftyNAV',
  'units', 'cashflow', 'dailyPnL', 'dailyReturn', 'drawdown', 'navMA200',
  'xirr', 'cagr', 'nifty500Momentum50NAV', 'niftyMicrocap250NAV',
  'niftyMidcap100NAV', 'niftySmallcap250NAV',
];

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

  const info = await client.execute('PRAGMA table_info("DailyPortfolioSnapshot")');
  const existing = info.rows.map((r: any) => r.name as string);
  console.log('Existing columns in remote DailyPortfolioSnapshot:');
  console.log('  ' + existing.join(', '));

  const missing = EXPECTED.filter((c) => !existing.includes(c));
  console.log('\nMissing columns (in schema but NOT in remote):');
  console.log(missing.length ? '  ' + missing.join(', ') : '  (none)');

  client.close();
}

main().catch(console.error);
