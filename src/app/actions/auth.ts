'use server';

import { revalidatePath } from 'next/cache';
import { getTokenStatus } from '@/lib/upstox/auth';
import type { TokenStatus } from '@/lib/upstox/types';
import { 
  getZerodhaTokenStatus, 
  disconnectZerodha, 
  getAuthenticatedKiteClient, 
  fetchExecutedOrders,
  type ZerodhaTokenStatus 
} from '@/lib/kite-client';
import { ingestOrdersWithDeduplication, type KiteOrder } from '@/lib/import-service';

/**
 * Get current Upstox token status
 */
export async function getUpstoxTokenStatus(): Promise<TokenStatus> {
  return getTokenStatus();
}

/**
 * Get current Zerodha token status
 */
export async function getZerodhaSessionStatus(): Promise<ZerodhaTokenStatus> {
  return getZerodhaTokenStatus();
}

/**
 * Disconnect Zerodha session
 */
export async function disconnectZerodhaSession(): Promise<{ success: boolean }> {
  const result = await disconnectZerodha();
  revalidatePath('/settings');
  return result;
}

/**
 * On-demand sync of today's executed Zerodha orders directly from UI
 */
export async function syncZerodhaOrdersNow(): Promise<{
  success: boolean;
  synced: number;
  skipped: number;
  message: string;
}> {
  try {
    const kc = await getAuthenticatedKiteClient();
    const executedOrders = await fetchExecutedOrders(kc);

    if (executedOrders.length === 0) {
      return {
        success: true,
        synced: 0,
        skipped: 0,
        message: 'No executed orders found on Zerodha for today.',
      };
    }

    const orders: KiteOrder[] = executedOrders.map(o => ({
      orderId: o.orderId,
      symbol: o.symbol,
      transactionType: o.transactionType,
      quantity: o.quantity,
      averagePrice: o.averagePrice,
      orderTimestamp: o.orderTimestamp,
    }));

    const result = await ingestOrdersWithDeduplication(orders, 'manual-sync-zerodha');

    revalidatePath('/trades');
    revalidatePath('/dashboard');
    revalidatePath('/live');
    revalidatePath('/settings');

    return {
      success: true,
      synced: result.synced,
      skipped: result.skipped,
      message: result.synced > 0
        ? `Successfully synced ${result.synced} order(s) (${result.skipped} skipped). Portfolio recalculation triggered.`
        : `All ${result.skipped} orders already synced.`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error during order sync';
    return {
      success: false,
      synced: 0,
      skipped: 0,
      message: msg,
    };
  }
}
