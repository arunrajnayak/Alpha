'use server';

import { 
    buildCncLimitOrders,
    calculateRebalancePreflight, 
    executeOrderBatch, 
    executeSingleOrder,
    generateKitePublisherBasket,
    fetchKiteOrdersStatus,
    modifyZerodhaOrder,
    cancelZerodhaOrder
} from '@/lib/zerodha/orders';
import { getStoredZerodhaToken } from '@/lib/kite-client';
import type { 
    RebalanceOrderItem, 
    RebalancePreflightSummary, 
    OrderExecutionResult, 
    OrderLiveStatus 
} from '@/lib/types';
import type { RebalanceAction } from '@/lib/rebalance';

export type ActionResponse<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: string;
    isAuthError?: boolean;
};

/**
 * Server action to generate pre-flight summary (margins, virtual contract note charges, available cash)
 * for proposed rebalance actions.
 */
export async function getRebalancePreflightAction(
    actionsOrOrders: RebalanceAction[] | RebalanceOrderItem[],
    priceMapRecord?: Record<string, number>
): Promise<ActionResponse<RebalancePreflightSummary>> {
    try {
        let orders: RebalanceOrderItem[];

        // Check if input is already RebalanceOrderItem[] or RebalanceAction[]
        if (actionsOrOrders.length > 0 && 'orderType' in actionsOrOrders[0]) {
            orders = actionsOrOrders as RebalanceOrderItem[];
        } else {
            const priceMap = priceMapRecord ? new Map(Object.entries(priceMapRecord)) : undefined;
            orders = await buildCncLimitOrders(actionsOrOrders as RebalanceAction[], priceMap);
        }

        const data = await calculateRebalancePreflight(orders);
        return { success: true, data };
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to calculate rebalance pre-flight';
        return {
            success: false,
            error: msg,
            isAuthError: msg.toLowerCase().includes('token') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('auth'),
        };
    }
}

/**
 * Server action to execute a batch of CNC Limit orders.
 * Orders are executed sequentially with SELL-first sequencing.
 */
export async function executeRebalanceBatchAction(
    orders: RebalanceOrderItem[]
): Promise<ActionResponse<OrderExecutionResult[]>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active. Please connect Zerodha in Settings first.',
                isAuthError: true,
            };
        }

        // Validate strictly CNC and LIMIT
        for (const o of orders) {
            if (o.orderType !== 'LIMIT' || o.product !== 'CNC') {
                return {
                    success: false,
                    error: `Order for ${o.symbol} must be strictly CNC Limit order. Found ${o.product} ${o.orderType}.`,
                };
            }
        }

        const results = await executeOrderBatch(orders);
        return { success: true, data: results };
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to execute rebalance orders';
        return {
            success: false,
            error: msg,
            isAuthError: msg.toLowerCase().includes('token') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('auth'),
        };
    }
}

/**
 * Server action to execute an individual CNC Limit order (e.g. for row-level retry).
 */
export async function executeSingleOrderAction(
    order: RebalanceOrderItem
): Promise<ActionResponse<OrderExecutionResult>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active.',
                isAuthError: true,
            };
        }

        if (order.orderType !== 'LIMIT' || order.product !== 'CNC') {
            return {
                success: false,
                error: `Order must be strictly CNC Limit order. Found ${order.product} ${order.orderType}.`,
            };
        }

        const result = await executeSingleOrder(order);
        return { success: true, data: result };
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to place order';
        return {
            success: false,
            error: msg,
            isAuthError: msg.toLowerCase().includes('token') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('auth'),
        };
    }
}

/**
 * Server action to generate Kite Publisher Basket payload.
 */
export async function getKitePublisherBasketAction(
    orders: RebalanceOrderItem[]
): Promise<ActionResponse<{ actionUrl: string; apiKey: string; dataJson: string }>> {
    try {
        const payload = await generateKitePublisherBasket(orders);
        return { success: true, data: payload };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate Kite Publisher basket',
        };
    }
}

/**
 * Server action to poll live execution status of placed orders from Kite Connect.
 */
export async function checkRebalanceOrdersStatusAction(
    orderIds: string[]
): Promise<ActionResponse<Record<string, OrderLiveStatus>>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active.',
                isAuthError: true,
            };
        }

        const statusMap = await fetchKiteOrdersStatus(orderIds);
        return { success: true, data: statusMap };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to check orders status',
        };
    }
}

/**
 * Server action to modify an open limit order in Zerodha.
 */
export async function modifyZerodhaOrderAction(
    orderId: string,
    params: { price?: number; quantity?: number }
): Promise<ActionResponse<{ orderId: string }>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active.',
                isAuthError: true,
            };
        }

        const result = await modifyZerodhaOrder(orderId, params);
        return { success: true, data: result };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to modify order',
        };
    }
}

/**
 * Server action to cancel an open order in Zerodha.
 */
export async function cancelZerodhaOrderAction(
    orderId: string
): Promise<ActionResponse<{ orderId: string }>> {
    try {
        const token = await getStoredZerodhaToken();
        if (!token) {
            return {
                success: false,
                error: 'Zerodha session is not active.',
                isAuthError: true,
            };
        }

        const result = await cancelZerodhaOrder(orderId);
        return { success: true, data: result };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to cancel order',
        };
    }
}
