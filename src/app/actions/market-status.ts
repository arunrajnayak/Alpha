'use server';

import { prisma } from '@/lib/db';
import { getMarketTimings, MarketTiming, hasValidToken } from '@/lib/upstox-client';

export interface MarketStatusResult {
    isOpen: boolean;
    status: string;
    timings: MarketTiming[];
    nextOpen?: string;
    lastDataDate: string | null;
}

export async function checkMarketStatus(date: string): Promise<MarketStatusResult> {
  try {
      // Fetch latest snapshot date first (independent of Upstox token)
      // We look for the latest resolved snapshot to indicate "Valid Data Date"
      const latestSnapshot = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' },
        select: { date: true }
      });
      
      const lastDataDate = latestSnapshot?.date ? latestSnapshot.date.toISOString().split('T')[0] : null;

      // Check for valid token BEFORE trying to fetch timings
      const hasToken = await hasValidToken();
      if (!hasToken) {
           return {
               isOpen: false,
               status: 'Status Unavailable',
               timings: [],
               lastDataDate
           };
      }

      // Fetch official timings from Upstox
      const allTimings = await getMarketTimings(date);


      // Filter for NSE Equity (or NSE in general)
      const nseTimings = allTimings.filter(t => t.exchange === 'NSE');

      if (nseTimings.length === 0) {
          return {
              isOpen: false,
              status: 'Closed (Holiday/Weekend)',
              timings: [],
              lastDataDate
          };
      }
      
      const now = Date.now();
      const isOpen = nseTimings.some(t => now >= t.start_time && now <= t.end_time);
      
      let status = isOpen ? 'Live' : 'Closed';
      
      // Enhance status message
      if (!isOpen) {
          const upcomings = nseTimings.filter(t => t.start_time > now);
          if (upcomings.length > 0) {
              const next = upcomings[0];
              const nextDate = new Date(next.start_time);
              status = `Closed (Opens ${nextDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })})`;
          } else if (nseTimings.some(t => t.end_time < now)) {
               status = 'Closed (Market Ended)';
          }
      }

      return {
          isOpen,
          status,
          timings: nseTimings,
          lastDataDate
      };

  } catch (error) {
      console.error('Failed to fetch market timings:', error);
      // Fallback
      return {
          isOpen: false,
          status: 'Status Unavailable',
          timings: [],
          lastDataDate: null
      };
  }
}
