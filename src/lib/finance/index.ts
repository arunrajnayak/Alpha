/**
 * Finance Module
 *
 * Re-exports all finance functions from domain-specific modules.
 */

// Types
export * from './types';

// Valuation (pre-existing)
export * from './valuation';

// Stock history
export { updateStockHistory } from './stock-history';

// Index history
export { updateIndexHistory } from './index-history';

// Recalculation
export { computePortfolioState, recalculatePortfolioHistory, recalculatePortfolioHistoryInternal } from './recalculation';

// Holdings
export { getPortfolioHoldings, getActiveHoldingsSummary, getStockPriceHistory, getHistoricalPortfolioHoldings, calculatePortfolioXIRR } from './holdings';
export type { ActiveHoldingSummary } from './holdings';

// Snapshots & Dashboard
export { getDashboardHistory, captureWeeklySnapshot, captureMonthlySnapshot, captureHolidaySnapshot, getLatestPortfolioStats, getDashboardStats } from './snapshots';
