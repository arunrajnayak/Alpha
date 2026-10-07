import MarketOverviewClient from './MarketOverviewClient';
import { fetchAllIndexSummaries, fetchMarketOverview } from '@/app/actions/market-overview';
import { fetchNSEMarketBreadth, fetchMarketHealthHistory, getIntradayMarketBreadth } from '@/app/actions/market-breadth';
import { fetchInstitutionalActivity } from '@/app/actions/institutional';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Markets health | Alpha',
  description: 'Market Breadth, Advances/Declines, Moves Distribution, and Market Health Dashboard',
};

export default async function MarketPage() {
  const [summariesRes, breadthData, healthData, intradayData, institutionalData, initialOverview] = await Promise.all([
    fetchAllIndexSummaries().catch(() => ({ summaries: [], tokenStatus: undefined })),
    fetchNSEMarketBreadth().catch(() => null),
    fetchMarketHealthHistory('1Y').catch(() => null),
    getIntradayMarketBreadth().catch(() => null),
    fetchInstitutionalActivity('Daily').catch(() => null),
    fetchMarketOverview('NIFTY Total Market').catch(() => null),
  ]);

  return (
    <div className="container mx-auto px-2 sm:px-4 py-3 md:py-6 max-w-7xl">
      <MarketOverviewClient
        initialSummaries={summariesRes.summaries}
        initialData={initialOverview}
        initialTokenStatus={summariesRes.tokenStatus || initialOverview?.tokenStatus}
        initialBreadthData={breadthData}
        initialHealthData={healthData}
        initialIntradayData={intradayData}
        initialInstitutionalData={institutionalData}
      />
    </div>
  );
}
