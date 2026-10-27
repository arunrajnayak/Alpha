'use server';

import { 
    reconcilePortfolioWithZerodha, 
    fetchZerodhaMargins 
} from '@/lib/zerodha/portfolio';
import type { 
    DematReconciliationResult, 
    BrokerCashMetrics 
} from '@/lib/types';
import { getStoredZerodhaToken } from '@/lib/kite-client';

export type ActionResponse<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: string;
    isAuthError?: boolean;
};

/**
 * Server action to run Demat vs Alpha holdings reconciliation
 */
export async function getDematReconciliationAction(): Promise<ActionResponse<DematReconciliationResult>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active. Please connect Zerodha in Settings first.',
                isAuthError: true,
            };
        }

        const data = await reconcilePortfolioWithZerodha();
        return { success: true, data };
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to reconcile portfolio with Zerodha';
        return {
            success: false,
            error: msg,
            isAuthError: msg.toLowerCase().includes('token') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('auth'),
        };
    }
}

/**
 * Server action to fetch broker available cash and margins
 * (Strictly informational: NEVER factored into NAV or XIRR)
 */
export async function getBrokerCashMetricsAction(): Promise<ActionResponse<BrokerCashMetrics>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active.',
                isAuthError: true,
            };
        }

        const data = await fetchZerodhaMargins();
        return { success: true, data };
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to fetch broker cash metrics';
        return {
            success: false,
            error: msg,
            isAuthError: msg.toLowerCase().includes('token') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('auth'),
        };
    }
}
