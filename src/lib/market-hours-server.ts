import { getMarketStatus } from './market-holidays-cache';

/**
 * Async version that checks market holidays via Upstox API
 * Use this for server-side checks or when you need accurate holiday detection
 */
export const isMarketOpenAsync = async (): Promise<boolean> => {
  const status = await getMarketStatus();
  return status.isOpen;
};
