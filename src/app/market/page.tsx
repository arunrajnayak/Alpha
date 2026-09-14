import MarketOverviewClient from './MarketOverviewClient';
import { fetchAllIndexSummaries, fetchMarketOverview } from '@/app/actions/market-overview';
import { fetchNSEMarketBreadth, fetchMarketHealthHistory, getIntradayMarketBreadth } from '@/app/actions/market-breadth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Markets health | Alpha',
  description: 'Market Breadth, Advances/Declines, Moves Distribution, and Market Health Dashboard',
};

export default async function MarketPage() {
  const [summariesRes, overviewData, breadthData, healthData, intradayData] = await Promise.all([
    fetchAllIndexSummaries().catch(() => ({ summaries: [], tokenStatus: undefined })),
    fetchMarketOverview('NIFTY Total Market').catch(() => null),
    fetchNSEMarketBreadth().catch(() => null),
    fetchMarketHealthHistory('1Y').catch(() => null),
    getIntradayMarketBreadth().catch(() => null),
  ]);

  return (
    <div className="container mx-auto px-4 py-4 md:py-6 max-w-7xl">
      <MarketOverviewClient
        initialSummaries={summariesRes.summaries}
        initialData={overviewData}
        initialTokenStatus={summariesRes.tokenStatus}
        initialBreadthData={breadthData}
        initialHealthData={healthData}
        initialIntradayData={intradayData}
      />
    </div>
  );
}
