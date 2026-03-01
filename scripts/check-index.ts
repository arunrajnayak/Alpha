import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoAuth = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoAuth) process.exit(1);

  const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoAuth });
  const prisma = new PrismaClient({ adapter });

  try {
      console.log('Checking IndexHistory for Jan 30 - Feb 1 2026...');
      const indices = await prisma.indexHistory.findMany({
        where: {
          date: {
            gte: new Date('2026-01-30T00:00:00Z'),
            lt: new Date('2026-02-02T00:00:00Z')
          },
          symbol: 'NIFTY50'
        },
        orderBy: { date: 'asc' }
      });
      indices.forEach(i => console.log(i.date.toISOString(), i.symbol, i.close));
      
      const snapshot = await prisma.dailyPortfolioSnapshot.findFirst({
         where: {
            date: {
                gte: new Date('2026-02-01T00:00:00Z'),
                lt: new Date('2026-02-02T00:00:00Z')
            }
         }
      });
      console.log('Feb 1st Snapshot Index Values:', {
         nifty: snapshot?.niftyNAV,
         date: snapshot?.date
      });

  } catch (e) {
      console.error(e);
  } finally {
      await prisma.$disconnect();
  }
}

main();
