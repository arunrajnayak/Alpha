/**
 * Zerodha Orders & Rebalance Execution Service
 * Manages strictly CNC Limit Orders, margin pre-flight checks,
 * virtual contract note charges, and execution sequencing.
 */

import { getAuthenticatedKiteClient, getStoredZerodhaToken } from '@/lib/kite-client';
import { prisma } from '@/lib/db';
import { getSymbolResolver } from '@/lib/amfi';
import { logger } from '@/lib/logger';
import { fetchZerodhaMargins } from '@/lib/zerodha/portfolio';
import type { RebalanceAction } from '@/lib/rebalance';
import type { 
    RebalanceOrderItem, 
    RebalancePreflightSummary, 
    OrderExecutionResult, 
    OrderLiveStatus,
    RebalanceChargesBreakdown
} from '@/lib/types';

const orderLogger = logger.scope('ZerodhaOrders');

/**
 * NSE/BSE Equity standard tick size is ₹0.05.
 * Round price strictly to the nearest valid tick and fix to 2 decimals.
 */
export function roundToTick(price: number, tick: number = 0.05): number {
    if (!Number.isFinite(price) || price <= 0) return 0.05;
    const rounded = Math.round(price / tick) * tick;
    return Number(rounded.toFixed(2));
}

/**
 * Builds strictly CNC Limit order items from RebalanceActions.
 * Orders are sequenced: SELL orders first, then BUY orders.
 * Default Limit Price is exact current LTP rounded to ₹0.05 tick size.
 */
export async function buildCncLimitOrders(
    actions: RebalanceAction[],
    priceMap?: Map<string, number>
): Promise<RebalanceOrderItem[]> {
    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);

    const orders: RebalanceOrderItem[] = [];

    for (const a of actions) {
        if (!a.qty || a.qty <= 0) continue;

        const canonicalSymbol = resolveSymbol(a.symbol);
        const ltp = priceMap?.get(a.symbol) ?? (a.value > 0 && a.qty > 0 ? a.value / a.qty : 0);
        const limitPrice = roundToTick(ltp);

        orders.push({
            symbol: canonicalSymbol,
            exchange: 'NSE', // Primary Indian equity exchange
            transactionType: a.action,
            quantity: Math.round(a.qty),
            orderType: 'LIMIT', // STRICTLY LIMIT ORDER
            product: 'CNC',     // STRICTLY CASH & CARRY (DELIVERY)
            price: limitPrice,
            currentPrice: ltp,
            currentQty: a.currentQty,
            targetQty: a.targetQty,
            status: 'idle',
        });
    }

    // Sequence: SELL orders first to release margin, then BUY orders
    orders.sort((x, y) => {
        if (x.transactionType === y.transactionType) return 0;
        return x.transactionType === 'SELL' ? -1 : 1;
    });

    return orders;
}

/**
 * Fallback charges estimation based on standard Indian equity delivery rates.
 * Used if Kite charges API is unavailable or returns 0.
 */
function estimateStandardDeliveryCharges(orders: RebalanceOrderItem[]): RebalanceChargesBreakdown {
    let totalBuy = 0;
    let totalSell = 0;

    for (const o of orders) {
        const val = o.quantity * o.price;
        if (o.transactionType === 'BUY') totalBuy += val;
        else totalSell += val;
    }

    const totalTurnover = totalBuy + totalSell;
    // Zerodha charges ₹0 brokerage for equity delivery (CNC)
    const brokerage = 0;
    // STT is 0.1% on delivery buy and sell
    const stt = totalTurnover * 0.001;
    // Exchange turnover fee (NSE): 0.00297%
    const exchangeTurnover = totalTurnover * 0.0000297;
    // SEBI turnover charge: ₹10 per crore
    const sebiCharges = totalTurnover * 0.000001;
    // Stamp duty: 0.015% on buy only
    const stampDuty = totalBuy * 0.00015;
    // GST: 18% on (brokerage + exchange turnover + SEBI charges)
    const gst = (brokerage + exchangeTurnover + sebiCharges) * 0.18;

    const totalCharges = Number((brokerage + stt + exchangeTurnover + gst + sebiCharges + stampDuty).toFixed(2));

    return {
        brokerage,
        stt: Number(stt.toFixed(2)),
        exchangeTurnover: Number(exchangeTurnover.toFixed(2)),
        gst: Number(gst.toFixed(2)),
        sebiCharges: Number(sebiCharges.toFixed(2)),
        stampDuty: Number(stampDuty.toFixed(2)),
        totalCharges,
    };
}

/**
 * Pre-flight calculation:
 * Queries Kite Connect's free /margins/basket and /charges/orders endpoints
 * to verify margin adequacy and give an exact tax breakdown.
 */
export async function calculateRebalancePreflight(
    orders: RebalanceOrderItem[]
): Promise<RebalancePreflightSummary> {
    orderLogger.info(`Calculating rebalance pre-flight for ${orders.length} CNC Limit orders...`);

    let totalBuyValue = 0;
    let totalSellValue = 0;

    for (const o of orders) {
        const val = o.quantity * o.price;
        if (o.transactionType === 'BUY') totalBuyValue += val;
        else totalSellValue += val;
    }

    const netCashImpact = totalSellValue - totalBuyValue;

    // Check Zerodha session
    const storedToken = await getStoredZerodhaToken();
    if (!storedToken) {
        // Return without live API check if not connected
        const fallbackCharges = estimateStandardDeliveryCharges(orders);
        return {
            orders,
            totalBuyValue,
            totalSellValue,
            netCashImpact,
            requiredMargin: totalBuyValue,
            availableCash: 0,
            marginShortfall: totalBuyValue,
            isMarginSufficient: false,
            charges: fallbackCharges,
            hasActiveSession: false,
        };
    }

    let availableCash = 0;
    let requiredMargin = totalBuyValue;
    let charges = estimateStandardDeliveryCharges(orders);

    try {
        const kc = await getAuthenticatedKiteClient();

        // 1. Fetch available cash funds from Zerodha
        const margins = await fetchZerodhaMargins();
        availableCash = margins.availableCash;

        // 2. Query /margins/basket via Kite SDK
        if (orders.length > 0) {
            try {
                const basketPayload = orders.map(o => ({
                    exchange: o.exchange,
                    tradingsymbol: o.symbol,
                    transaction_type: o.transactionType,
                    variety: 'regular',
                    product: 'CNC',
                    order_type: 'LIMIT',
                    quantity: o.quantity,
                    price: o.price,
                }));

                const marginResp = await kc.orderBasketMargins(basketPayload, true);
                if (marginResp?.initial?.total !== undefined) {
                    requiredMargin = Number(marginResp.initial.total);
                } else if (marginResp?.final?.total !== undefined) {
                    requiredMargin = Number(marginResp.final.total);
                }
            } catch (marginErr) {
                orderLogger.warn('Kite orderBasketMargins query failed, using totalBuyValue fallback:', marginErr);
            }

            // 3. Query /charges/orders (virtual contract note) via Kite SDK
            try {
                const contractNotePayload = orders.map((o, idx) => ({
                    order_id: String(idx + 1),
                    exchange: o.exchange,
                    tradingsymbol: o.symbol,
                    transaction_type: o.transactionType,
                    variety: 'regular',
                    product: 'CNC',
                    order_type: 'LIMIT',
                    quantity: o.quantity,
                    average_price: o.price,
                }));

                const chargesResp = await kc.getvirtualContractNote(contractNotePayload);
                if (Array.isArray(chargesResp) && chargesResp.length > 0) {
                    let totalStt = 0;
                    let totalExc = 0;
                    let totalGst = 0;
                    let totalSebi = 0;
                    let totalStamp = 0;
                    let totalBrokerage = 0;

                    for (const c of chargesResp) {
                        const ch = c?.charges || c;
                        totalBrokerage += Number(ch.brokerage ?? 0);
                        totalStt += Number(ch.transaction_tax ?? 0);
                        totalExc += Number(ch.exchange_turnover_charge ?? 0);
                        totalSebi += Number(ch.sebi_turnover_charge ?? 0);
                        totalStamp += Number(ch.stamp_duty ?? 0);
                        const gstObj = ch.gst;
                        if (typeof gstObj === 'object' && gstObj !== null) {
                            totalGst += Number(gstObj.total ?? 0);
                        } else {
                            totalGst += Number(gstObj ?? 0);
                        }
                    }

                    charges = {
                        brokerage: totalBrokerage,
                        stt: Number(totalStt.toFixed(2)),
                        exchangeTurnover: Number(totalExc.toFixed(2)),
                        gst: Number(totalGst.toFixed(2)),
                        sebiCharges: Number(totalSebi.toFixed(2)),
                        stampDuty: Number(totalStamp.toFixed(2)),
                        totalCharges: Number((totalBrokerage + totalStt + totalExc + totalGst + totalSebi + totalStamp).toFixed(2)),
                    };
                }
            } catch (chargeErr) {
                orderLogger.warn('Kite getvirtualContractNote query failed, using delivery tax formula:', chargeErr);
            }
        }
    } catch (err) {
        orderLogger.error('Failed to query Zerodha Kite for pre-flight:', err);
    }

    // Effective margin shortfall
    const marginShortfall = Math.max(0, requiredMargin - availableCash);
    const isMarginSufficient = availableCash >= requiredMargin;

    return {
        orders,
        totalBuyValue,
        totalSellValue,
        netCashImpact,
        requiredMargin,
        availableCash,
        marginShortfall,
        isMarginSufficient,
        charges,
        hasActiveSession: true,
    };
}

/**
 * Execute a single CNC Limit order directly in Zerodha.
 */
export async function executeSingleOrder(order: RebalanceOrderItem): Promise<OrderExecutionResult> {
    try {
        const kc = await getAuthenticatedKiteClient();

        orderLogger.info(`Placing ${order.transactionType} ${order.quantity} ${order.symbol} @ ₹${order.price} (CNC LIMIT)...`);

        const resp = await kc.placeOrder('regular', {
            exchange: order.exchange,
            tradingsymbol: order.symbol,
            transaction_type: order.transactionType,
            quantity: order.quantity,
            product: 'CNC',     // HARD-CODED CNC
            order_type: 'LIMIT', // HARD-CODED LIMIT
            price: order.price,
            validity: 'DAY',
            tag: 'alpha-rebal',
        });

        const orderId = resp?.order_id || String(resp);
        orderLogger.info(`Order placed successfully! Order ID: ${orderId}`);

        return {
            symbol: order.symbol,
            transactionType: order.transactionType,
            quantity: order.quantity,
            price: order.price,
            orderId,
            success: true,
        };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        orderLogger.error(`Failed to place ${order.transactionType} ${order.symbol}:`, errMsg);
        return {
            symbol: order.symbol,
            transactionType: order.transactionType,
            quantity: order.quantity,
            price: order.price,
            success: false,
            error: errMsg,
        };
    }
}

/**
 * Execute a batch of CNC Limit orders with sell-first sequencing.
 * If any SELL order fails, execution of subsequent BUY orders is paused
 * to avoid overspending without the expected sell proceeds.
 */
export async function executeOrderBatch(
    orders: RebalanceOrderItem[],
    onProgress?: (index: number, result: OrderExecutionResult) => void
): Promise<OrderExecutionResult[]> {
    const results: OrderExecutionResult[] = [];

    // Separate SELL and BUY orders
    const sellOrders = orders.filter(o => o.transactionType === 'SELL' && o.status !== 'placed');
    const buyOrders = orders.filter(o => o.transactionType === 'BUY' && o.status !== 'placed');

    let anySellFailed = false;

    // 1. Execute SELL orders first
    for (let i = 0; i < sellOrders.length; i++) {
        const o = sellOrders[i];
        const res = await executeSingleOrder(o);
        results.push(res);
        if (onProgress) onProgress(i, res);

        if (!res.success) {
            anySellFailed = true;
            orderLogger.warn(`SELL order failed for ${o.symbol}. Halting subsequent BUY orders for safety.`);
        }

        // Small delay between calls to comply with Kite rate limits (10 req/s)
        if (i < sellOrders.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // 2. If any SELL failed, abort BUY execution to protect funds
    if (anySellFailed && buyOrders.length > 0) {
        for (const o of buyOrders) {
            const abortedRes: OrderExecutionResult = {
                symbol: o.symbol,
                transactionType: o.transactionType,
                quantity: o.quantity,
                price: o.price,
                success: false,
                error: 'Aborted: Prior SELL order failed. Protects cash balance against overspend.',
            };
            results.push(abortedRes);
        }
        return results;
    }

    // 3. Execute BUY orders
    for (let i = 0; i < buyOrders.length; i++) {
        const o = buyOrders[i];
        const res = await executeSingleOrder(o);
        results.push(res);
        if (onProgress) onProgress(sellOrders.length + i, res);

        if (i < buyOrders.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return results;
}

/**
 * Generate Kite Publisher Basket payload.
 * Generates parameters for submitting directly to https://kite.zerodha.com/connect/basket.
 */
export async function generateKitePublisherBasket(
    orders: RebalanceOrderItem[]
): Promise<{ actionUrl: string; apiKey: string; dataJson: string }> {
    const apiKey = process.env.ZERODHA_API_KEY || '';

    const publisherOrders = orders.map(o => ({
        variety: 'regular',
        tradingsymbol: o.symbol,
        exchange: o.exchange,
        transaction_type: o.transactionType,
        order_type: 'LIMIT', // Strictly LIMIT
        quantity: o.quantity,
        price: o.price,
        product: 'CNC',      // Strictly CNC
        readonly: false,
    }));

    return {
        actionUrl: 'https://kite.zerodha.com/connect/basket',
        apiKey,
        dataJson: JSON.stringify(publisherOrders),
    };
}

/**
 * Modify an open order in Zerodha (e.g. adjust limit price or quantity).
 */
export async function modifyZerodhaOrder(
    orderId: string,
    params: { price?: number; quantity?: number }
): Promise<{ orderId: string }> {
    try {
        const kc = await getAuthenticatedKiteClient();
        orderLogger.info(`Modifying order #${orderId}:`, params);

        const payload: Record<string, unknown> = {
            order_type: 'LIMIT',
        };
        if (params.price !== undefined) {
            payload.price = Number(params.price.toFixed(2));
        }
        if (params.quantity !== undefined) {
            payload.quantity = Math.max(1, Math.round(params.quantity));
        }

        const resp = await kc.modifyOrder('regular', orderId, payload);
        const modifiedId = resp?.order_id || String(resp) || orderId;
        orderLogger.info(`Order #${orderId} modified successfully!`);
        return { orderId: modifiedId };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        orderLogger.error(`Failed to modify order #${orderId}:`, errMsg);
        throw new Error(errMsg);
    }
}

/**
 * Cancel an open order in Zerodha.
 */
export async function cancelZerodhaOrder(orderId: string): Promise<{ orderId: string }> {
    try {
        const kc = await getAuthenticatedKiteClient();
        orderLogger.info(`Cancelling order #${orderId}...`);

        const resp = await kc.cancelOrder('regular', orderId);
        const cancelledId = resp?.order_id || String(resp) || orderId;
        orderLogger.info(`Order #${orderId} cancelled successfully!`);
        return { orderId: cancelledId };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        orderLogger.error(`Failed to cancel order #${orderId}:`, errMsg);
        throw new Error(errMsg);
    }
}

/**
 * Fetch live status of placed orders from Kite Connect.
 */
export async function fetchKiteOrdersStatus(
    orderIds: string[]
): Promise<Record<string, OrderLiveStatus>> {
    try {
        const kc = await getAuthenticatedKiteClient();
        const allOrders = await kc.getOrders();
        const targetIds = new Set(orderIds);
        const statusMap: Record<string, OrderLiveStatus> = {};

        if (Array.isArray(allOrders)) {
            for (const o of allOrders) {
                const id = String(o.order_id);
                if (targetIds.has(id)) {
                    statusMap[id] = {
                        orderId: id,
                        symbol: o.tradingsymbol,
                        status: o.status as OrderLiveStatus['status'],
                        filledQuantity: Number(o.filled_quantity || 0),
                        pendingQuantity: Number(o.pending_quantity || 0),
                        averagePrice: Number(o.average_price || 0),
                        statusMessage: o.status_message,
                    };
                }
            }
        }

        return statusMap;
    } catch (err) {
        orderLogger.error('Failed to fetch orders status from Kite:', err);
        throw err;
    }
}
