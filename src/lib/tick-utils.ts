/**
 * Utility functions for exchange tick sizes and price rounding.
 * Client-safe (no server or Node.js dependencies).
 * 
 * References:
 * - NSE Circular & Zerodha Bulletin 408151 (Effective April 15, 2025):
 *   Revision in tick size for NSE Capital Market (Cash) segment and Stock Futures.
 *   https://zerodha.com/marketintel/bulletin/408151/revision-in-tick-size-for-nse-derivatives-and-cash-segment-from-april-15-2025
 */

/**
 * NSE/BSE Equity standard tick size by security price slab (effective April 15, 2025):
 * - Below ₹250: ₹0.01 (1 paisa)
 * - ₹250 to ₹1,000: ₹0.05 (5 paise)
 * - > ₹1,000 to ₹5,000: ₹0.10 (10 paise)
 * - > ₹5,000 to ₹10,000: ₹0.50 (50 paise)
 * - > ₹10,000 to ₹20,000: ₹1.00 (1 rupee)
 * - Above ₹20,000: ₹5.00 (5 rupees)
 */
export function getTickSize(price: number): number {
    if (!Number.isFinite(price) || price <= 0) return 0.05;
    if (price < 250) return 0.01;
    if (price <= 1000) return 0.05;
    if (price <= 5000) return 0.10;
    if (price <= 10000) return 0.50;
    if (price <= 20000) return 1.00;
    return 5.00;
}

/**
 * Round price strictly to the nearest valid tick and fix to 2 decimals.
 */
export function roundToTick(price: number, tick?: number): number {
    if (!Number.isFinite(price) || price <= 0) return 0.05;
    const t = tick ?? getTickSize(price);
    const rounded = Math.round(price / t) * t;
    return Number(rounded.toFixed(2));
}

/**
 * Computes the next valid price step (+1 or -1 tick), correctly handling
 * slab boundary transitions (e.g. crossing ₹250, ₹1,000, ₹5,000, etc.).
 */
export function getNextTickPrice(price: number, direction: 1 | -1): number {
    if (!Number.isFinite(price) || price <= 0) return 0.05;
    if (direction > 0) {
        const candidate = price + 0.0001;
        const tick = getTickSize(candidate);
        const next = Math.ceil(candidate / tick) * tick;
        return Number(next.toFixed(2));
    } else {
        const candidate = price - 0.0001;
        if (candidate <= 0) return getTickSize(0.01);
        const tick = getTickSize(candidate);
        const prev = Math.floor(candidate / tick) * tick;
        return Number(Math.max(tick, prev).toFixed(2));
    }
}
