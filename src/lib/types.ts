export interface SectorAllocation {
  sector: string;
  value: number;
  allocation: number;
  count: number;
  dayChangePercent: number;
}

export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro' | 'Nano';

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
  upcomingDemerger?: { exDate: string; daysUntil: number };
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
  dividends: number;
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

/**
 * Zerodha Demat Holding shape
 */
export interface KiteDematHolding {
  symbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1Quantity: number;
  realisedQuantity: number;
  authorisedQuantity: number;
  averagePrice: number;
  lastPrice: number;
  closePrice: number;
  pnl: number;
  pledgedQuantity: number;
  collateralQuantity: number;
  collateralType?: string;
  discrepancy: boolean;
}

/**
 * Item in the Demat vs Alpha reconciliation comparison
 */
export interface DematReconciliationItem {
  symbol: string;
  companyName?: string;
  alphaQty: number;
  dematQty: number; // total quantity in Zerodha (settled + T1)
  settledQty?: number; // settled quantity delivered to Demat
  deltaQty: number; // dematQty - alphaQty
  t1Qty: number;
  pledgedQty: number;
  alphaAvgPrice: number;
  dematAvgPrice: number;
  currentPrice: number;
  alphaValue: number;
  dematValue: number;
  valueDiff: number;
  status: 'matched' | 'discrepancy' | 'missing_in_alpha' | 'missing_in_demat';
  potentialReason?: string;
}

/**
 * Aggregate summary for Demat reconciliation
 */
export interface DematReconciliationSummary {
  totalDematValue: number;
  totalAlphaValue: number;
  netDifferenceValue: number;
  totalDematStocks: number;
  totalAlphaStocks: number;
  matchedCount: number;
  discrepancyCount: number;
  missingInAlphaCount: number;
  missingInDematCount: number;
  totalT1Shares: number;
  totalPledgedShares: number;
  lastSyncedAt: string;
}

export interface DematReconciliationResult {
  items: DematReconciliationItem[];
  summary: DematReconciliationSummary;
}

/**
 * Informational broker cash and margin metrics from Zerodha
 * (Strictly informational: NEVER factored into NAV or XIRR)
 */
export interface BrokerCashMetrics {
  availableCash: number;
  collateralMargin: number;
  liveBalance: number;
  utilisedDebits: number;
  holdingSales: number;
  net: number;
  lastUpdated: string;
}

