import { differenceInDays } from 'date-fns';

/**
 * Replay ordering priority for transactions that share the same date.
 *
 * Trades are imported with a date-only granularity (time is zeroed at import),
 * so intraday BUY/SELL pairs can end up in an arbitrary order. If a SELL is
 * replayed before its same-day BUY, the oversell is clamped to zero and its
 * quantity is silently lost — then the later BUY inflates the position, leaving
 * a phantom holding for a stock that was actually fully sold.
 *
 * To avoid this we always replay same-day events as:
 *   BUY  →  BONUS/SPLIT  →  SYMBOL_CHANGE  →  SELL
 * i.e. shares must exist (and reflect corporate actions) before any SELL runs.
 */
const REPLAY_TYPE_ORDER: Record<string, number> = {
    BUY: 0,
    BONUS: 1,
    SPLIT: 1,
    SYMBOL_CHANGE: 2,
    SELL: 3,
};

/**
 * Returns a new array of transactions sorted by date ascending, breaking ties
 * on the same date so BUYs (and corporate actions) are processed before SELLs.
 * The sort is stable within each (date, type) group, preserving import order.
 */
export function orderTransactionsForReplay<T extends { date: Date; type: string }>(transactions: T[]): T[] {
    return transactions
        .map((tx, index) => ({ tx, index }))
        .sort((a, b) => {
            const dateDiff = a.tx.date.getTime() - b.tx.date.getTime();
            if (dateDiff !== 0) return dateDiff;
            const typeDiff = (REPLAY_TYPE_ORDER[a.tx.type] ?? 99) - (REPLAY_TYPE_ORDER[b.tx.type] ?? 99);
            if (typeDiff !== 0) return typeDiff;
            return a.index - b.index; // stable tie-break
        })
        .map((entry) => entry.tx);
}

// Types
export interface PortfolioHolding {
    symbol: string;
    qty: number;
    invested: number; // Book Cost
    realizedPnl: number;
}

export interface InventoryBatch {
    qty: number;
    price: number;
    date: Date;
}

export interface TradeResult {
    pnl: number;
    returnPct: number;
    holdDays: number;
    invested: number; // Cost basis of sold items
    revenue: number; // Sold value
}

export class PortfolioEngine {
    holdings: Map<string, PortfolioHolding>;
    inventory: Map<string, InventoryBatch[]>;
    investedCapital: number; // Net external capital (Deposits - Withdrawals + Buys - Sells)
    dailyNetFlow: number; // Net flow FOR THE CURRENT DAY processing
    
    // Stats
    realizedPnl: number; // Cumulative
    
    constructor() {
        this.holdings = new Map();
        this.inventory = new Map();
        this.investedCapital = 0;
        this.dailyNetFlow = 0;
        this.realizedPnl = 0;
    }

    resetDailyFlow() {
        this.dailyNetFlow = 0;
    }

    // Process a Transaction (Buy/Sell)
    // Returns TradeResult if it was a SELL, null otherwise
    processTransaction(tx: { 
        symbol: string; 
        type: string; 
        quantity: number; 
        price: number; 
        date: Date; 
        splitRatio?: number | null; 
        newSymbol?: string | null; 
    }): TradeResult | null {
        const tradeVal = tx.quantity * tx.price;

        if (tx.type === 'BUY') {
            // BUY = Capital INjection to buy stock
            this.investedCapital += tradeVal;
            this.dailyNetFlow += tradeVal;

            // Update Holdings
            const current = this.holdings.get(tx.symbol) || { symbol: tx.symbol, qty: 0, invested: 0, realizedPnl: 0 };
            current.qty += tx.quantity;
            current.invested += tradeVal;
            this.holdings.set(tx.symbol, current);

            // Update Inventory (FIFO)
            if (!this.inventory.has(tx.symbol)) this.inventory.set(tx.symbol, []);
            this.inventory.get(tx.symbol)!.push({ qty: tx.quantity, price: tx.price, date: tx.date });

            return null;

        } else if (tx.type === 'SELL') {
            // SELL = Capital Withdrawal (Proceeds taken out)
            this.investedCapital -= tradeVal;
            this.dailyNetFlow -= tradeVal;
            
            // Update Holdings (net the quantity). We let the running quantity
            // cross zero instead of clamping at each step. If the recorded SELLs
            // for a symbol exceed its BUYs — e.g. missing buy imports or intraday
            // shorts — the position settles to a non-positive quantity and is
            // correctly excluded from current holdings, rather than leaving a
            // phantom positive position (which previously happened because the
            // per-step Math.max(0, ...) discarded the excess sell and a later BUY
            // then re-inflated the holding).
            const current = this.holdings.get(tx.symbol) || { symbol: tx.symbol, qty: 0, invested: 0, realizedPnl: 0 };
            // Use Average Cost for "Book Value" reduction (guard against div-by-zero)
            const avgPrice = current.qty > 0 ? current.invested / current.qty : 0;
            current.qty = current.qty - tx.quantity;
            if (current.qty > 0.00001) {
                // Still long — reduce cost basis by the average cost of shares sold.
                current.invested = Math.max(0, current.invested - (tx.quantity * avgPrice));
            } else {
                // Fully exited or over-sold — no remaining cost basis.
                current.invested = 0;
                // Snap tiny floating-point residuals to a clean zero.
                if (Math.abs(current.qty) < 0.00001) current.qty = 0;
            }
            this.holdings.set(tx.symbol, current);

            // Process Inventory for Realized PnL (FIFO)
            let qtySold = tx.quantity;
            let costBasis = 0;
            let weightedDays = 0;
            const originalQtySold = qtySold;

            // Initialize inventory queue if it doesn't exist
            if (!this.inventory.has(tx.symbol)) {
                this.inventory.set(tx.symbol, []);
            }
            const queue = this.inventory.get(tx.symbol)!;
            
            while (qtySold > 0 && queue.length > 0) {
                const batch = queue[0];
                const take = Math.min(batch.qty, qtySold);
                
                costBasis += take * batch.price;
                const days = differenceInDays(tx.date, batch.date);
                weightedDays += days * take;

                batch.qty -= take;
                if (batch.qty < 0.00001) queue.shift();
                qtySold -= take;
            }

            const revenue = originalQtySold * tx.price;
            const pnl = revenue - costBasis;
            this.realizedPnl += pnl;
            if (current) current.realizedPnl += pnl;

            return {
                pnl,
                returnPct: costBasis > 0 ? pnl / costBasis : 0,
                holdDays: originalQtySold > 0 ? weightedDays / originalQtySold : 0,
                invested: costBasis,
                revenue
            };

        } else if (tx.type === 'SPLIT' || tx.type === 'BONUS') {
            const ratio = tx.splitRatio || 1;
            this.applySplit(tx.symbol, ratio);
            return null;

        } else if (tx.type === 'SYMBOL_CHANGE') {
            if (tx.newSymbol) {
                this.migrateSymbol(tx.symbol, tx.newSymbol);
            }
            return null;
        }

        return null;
    }

    processCashflow(cf: { type: string; amount: number; date: Date }) {
        if (cf.type === 'DEPOSIT') {
            // Ignore Deposits - Account has no cash. 
            // In a "Stocks Only" view, a Deposit doesn't increase Equity until it's used to BUY.
            // But wait, if we ignore it, investedCapital tracking might be off for TWR if the user considers "Cash in Broker" as "Invested".
            // Prompt said: "We should take account for cash anywhere, because that doesn't account for cash balance in my trading account"
            // Implication: "My Trading Account" (Broker) is not the boundary. The boundary is the "Invested Positions".
            // So: Deposit -> (No Effect on Equity). Buy -> (Capital Call). Sell -> (Distribution).
            // However, Dividends MUST be captured.
        } else if (cf.type === 'WITHDRAWAL') {
            // Ignore (same logic as Deposit)
        } else if (cf.type === 'DIVIDEND') {
            // Dividend = Cash Out (Return of Capital / Income)
            // User Request: "Consider ONLY for historical holdings table".
            // So we DO NOT adjust investedCapital or dailyNetFlow here.
            // It is purely a stats-view item.
        }
    }

    applySplit(symbol: string, ratio: number) {
        if (ratio <= 0) return;

        // Update Holdings
        const current = this.holdings.get(symbol);
        if (current && current.qty > 0) {
            current.qty *= ratio;
            // Invested amount stays same
        }

        // Update Inventory
        const queue = this.inventory.get(symbol);
        if (queue) {
            queue.forEach(b => {
                b.qty *= ratio;
                b.price /= ratio;
            });
        }
    }



    migrateSymbol(oldSym: string, newSym: string) {
        const oldHolding = this.holdings.get(oldSym);
        if (oldHolding) {
            this.holdings.set(newSym, { ...oldHolding, symbol: newSym });
            this.holdings.delete(oldSym);
        }
        const oldInventory = this.inventory.get(oldSym);
        if (oldInventory) {
            this.inventory.set(newSym, oldInventory);
            this.inventory.delete(oldSym);
        }
    }

    // Get current valuation state
    // Requires a price map: Symbol -> Current Price
    getValuation(priceMap: Map<string, number>) {
        let stockValue = 0;
        const details = [];

        for (const [sym, h] of this.holdings) {
            if (h.qty <= 0.001) continue;
            const price = priceMap.get(sym) || 0;
            const val = h.qty * price;
            stockValue += val;
            
            details.push({
                symbol: sym,
                qty: h.qty,
                price: price, // Current Price
                invested: h.invested,
                currentValue: val,
                pnl: val - h.invested,
                pnlPercent: h.invested > 0 ? (val - h.invested) / h.invested : 0
            });
        }

        return {
            totalEquity: stockValue, // No Cash
            stockValue,
            cashBalance: 0,
            investedCapital: this.investedCapital,
            holdings: details
        };
    }
}
