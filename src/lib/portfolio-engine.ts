import { differenceInDays } from 'date-fns';

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

export interface ClosedTrade {
    date: Date;
    symbol: string;
    pnl: number;
    returnPct: number;
    holdDays: number;
    invested: number;
    revenue: number;
}

export class PortfolioEngine {
    holdings: Map<string, PortfolioHolding>;
    inventory: Map<string, InventoryBatch[]>;
    investedCapital: number; // Net external capital (Deposits - Withdrawals + Buys - Sells)
    dailyNetFlow: number; // Net flow FOR THE CURRENT DAY processing
    
    // Stats
    realizedPnl: number; // Cumulative
    wins: number;
    losses: number;
    totalWinPct: number;
    totalLossPct: number;
    totalHoldDays: number;
    closedTradesCount: number;
    closedTrades: ClosedTrade[];
    
    constructor() {
        this.holdings = new Map();
        this.inventory = new Map();
        this.investedCapital = 0;
        this.dailyNetFlow = 0;
        this.realizedPnl = 0;
        this.wins = 0;
        this.losses = 0;
        this.totalWinPct = 0;
        this.totalLossPct = 0;
        this.totalHoldDays = 0;
        this.closedTradesCount = 0;
        this.closedTrades = [];
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
            
            // Update Holdings (Reduce Qty)
            const current = this.holdings.get(tx.symbol);
            if (current && current.qty > 0) {
                // Use Average Cost for "Book Value" reduction
                // Guard against division by zero
                const avgPrice = current.qty > 0 ? current.invested / current.qty : 0;
                current.qty = Math.max(0, current.qty - tx.quantity);
                current.invested = Math.max(0, current.invested - (tx.quantity * avgPrice));
                // Cleanup tiny floating point residuals
                if (current.qty < 0.00001) { current.qty = 0; current.invested = 0; }
            }

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

            const returnPct = costBasis > 0 ? pnl / costBasis : 0;
            const holdDays = originalQtySold > 0 ? weightedDays / originalQtySold : 0;

            this.closedTradesCount++;
            this.totalHoldDays += holdDays;
            if (pnl > 0) {
                this.wins++;
                this.totalWinPct += returnPct;
            } else {
                this.losses++;
                this.totalLossPct += returnPct;
            }

            this.closedTrades.push({
                date: tx.date,
                symbol: tx.symbol,
                pnl,
                returnPct,
                holdDays,
                invested: costBasis,
                revenue
            });

            return {
                pnl,
                returnPct,
                holdDays,
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

    getTradeStats() {
        const winPercent = this.closedTradesCount > 0 ? (this.wins / this.closedTradesCount) * 100 : 0;
        const lossPercent = this.closedTradesCount > 0 ? (this.losses / this.closedTradesCount) * 100 : 0;
        const avgWinnerGain = this.wins > 0 ? (this.totalWinPct / this.wins) * 100 : 0;
        const avgLoserLoss = this.losses > 0 ? (this.totalLossPct / this.losses) * 100 : 0;
        const avgHoldingPeriod = this.closedTradesCount > 0 ? this.totalHoldDays / this.closedTradesCount : 0;

        return {
            wins: this.wins,
            losses: this.losses,
            closedTradesCount: this.closedTradesCount,
            totalWinPct: this.totalWinPct,
            totalLossPct: this.totalLossPct,
            totalHoldDays: this.totalHoldDays,
            winPercent,
            lossPercent,
            avgWinnerGain,
            avgLoserLoss,
            avgHoldingPeriod
        };
    }
}
