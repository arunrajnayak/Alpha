import { fetchMarketOverview, fetchAllIndexSummaries } from '@/app/actions/market-overview';
import MarketOverviewClient from './MarketOverviewClient';

// Enable caching for the pre-fetched structural data
export const revalidate = 60; // Cache responses for up to 60s at edge to prevent thrashing

export default async function MarketOverviewPage() {
  // Pre-fetch initial data on the server in parallel!
  // NIFTY 50 is the default selected index for the page.
  const [summariesRes, indexRes] = await Promise.all([
    fetchAllIndexSummaries(),
    fetchMarketOverview('NIFTY 50')
  ]);

  const tokenStatus = indexRes?.tokenStatus || summariesRes?.tokenStatus || null;

  return (
    <MarketOverviewClient
      initialSummaries={summariesRes?.summaries || []}
      initialData={indexRes}
      initialTokenStatus={tokenStatus}
    />
  );
}
