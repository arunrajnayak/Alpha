export interface SectorAllocation {
  sector: string;
  value: number;
  allocation: number;
  count: number;
  dayChangePercent: number;
}

export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro';

/**
 * Portfolio Holding - shared type for current holdings display
 * Matches the return shape of getPortfolioHoldings() in finance.ts
 */
export interface PortfolioHolding {
  symbol: string;
  quantity: number;
  invested: number;
  currentValue: number;
  price: number;
  pnl: number;
  pnlPercent: number;
  marketCap: number;
  marketCapCategory: MarketCapCategory;
  sector?: string;
  priceHistory?: { date: string; close: number }[];
  holdingPeriodDays?: number;
}

/**
 * Historical Holding - for historical holdings display with realized/unrealized P&L breakdown
 * Matches the return shape of getHistoricalPortfolioHoldings() in finance.ts
 */
export interface HistoricalHoldingData {
  symbol: string;
  quantity: number;
  currentPrice: number;
  currentValue: number;
  invested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

/**
 * Rebalance Input Holding - used as input for rebalance calculations
 * Compatible with PortfolioHolding but with optional fields
 */
export interface RebalanceInputHolding {
  symbol: string;
  quantity: number;
  invested: number;
  currentValue: number;
  price: number;
  pnl: number;
  pnlPercent: number;
  marketCapCategory?: string;
  sector?: string;
}
