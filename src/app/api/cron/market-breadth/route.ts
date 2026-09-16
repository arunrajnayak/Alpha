import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { isMarketOpenAsync } from '@/lib/marketHours';
import { fetchNSEMarketBreadth, saveIntradayMarketBreadth } from '@/app/actions/market-breadth';
import { logger } from '@/lib/logger';

const log = logger.scope('MarketBreadthCron');

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    // Check if market is open
    const isMarketOpen = await isMarketOpenAsync();
    if (!isMarketOpen) {
      log.info('Market is closed, skipping market breadth cron');
      return NextResponse.json({
        status: 'skipped',
        reason: 'Market is closed',
      });
    }

    log.info('Fetching live NSE market breadth for cron snapshot...');
    const breadthData = await fetchNSEMarketBreadth(true);

    if (breadthData.total >= 3000) {
      await saveIntradayMarketBreadth(breadthData);
      log.info(
        `Recorded intraday breadth: Adv=${breadthData.advances}, Dec=${breadthData.declines}, Total=${breadthData.total}`
      );
    } else {
      log.warn(`Skipping cron save, breadthData total too low (${breadthData.total})`);
    }

    return NextResponse.json({
      status: 'success',
      total: breadthData.total,
      advances: breadthData.advances,
      declines: breadthData.declines,
      unchanged: breadthData.unchanged,
      netAdvances: breadthData.netAdvances,
      adRatio: breadthData.adRatio,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Market breadth cron failed:', err);
    return NextResponse.json(
      { status: 'error', error: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
