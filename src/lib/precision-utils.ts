/**
 * Precision Utilities
 * 
 * Provides consistent rounding functions to ensure database values are stored
 * with appropriate decimal precision, preventing floating-point artifacts.
 */

/**
 * Generic rounding function
 * @param value - The number to round
 * @param decimals - Number of decimal places
 * @returns Rounded number
 */
export function roundTo(value: number | null | undefined, decimals: number): number {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Round price values (stock prices, NAV, etc.)
 * Uses 2 decimal places for currency precision
 * @param value - Price value
 * @returns Price rounded to 2 decimals
 */
export function roundPrice(value: number | null | undefined): number {
  return roundTo(value, 2);
}

/**
 * Round percentage and ratio values
 * Uses 4 decimal places to preserve precision for small percentages
 * @param value - Percentage/ratio value (e.g., 0.0523 = 5.23%)
 * @returns Percentage rounded to 4 decimals
 */
export function roundPercent(value: number | null | undefined): number {
  return roundTo(value, 4);
}

/**
 * Round quantity values (shares, units)
 * Uses 4 decimal places to handle fractional shares
 * @param value - Quantity value
 * @returns Quantity rounded to 4 decimals
 */
export function roundQuantity(value: number | null | undefined): number {
  return roundTo(value, 4);
}

/**
 * Round large equity/capital amounts
 * Uses 2 decimal places for currency precision
 * @param value - Equity/capital amount
 * @returns Amount rounded to 2 decimals
 */
export function roundEquity(value: number | null | undefined): number {
  return roundTo(value, 2);
}

/**
 * Round market cap values (in Crores)
 * Uses 2 decimal places
 * @param value - Market cap value
 * @returns Market cap rounded to 2 decimals
 */
export function roundMarketCap(value: number | null | undefined): number {
  return roundTo(value, 2);
}

/**
 * Round a portfolio snapshot object
 * Applies appropriate rounding to all numeric fields
 */
export function roundPortfolioSnapshot(snapshot: {
  totalEquity: number;
  investedCapital: number;
  portfolioNAV: number;
  niftyNAV?: number | null;
  units: number;
  cashflow?: number | null;
  dailyPnL?: number | null;
  dailyReturn?: number | null;
  drawdown?: number | null;
  navMA200?: number | null;
  nifty500Momentum50NAV?: number | null;
  niftyMicrocap250NAV?: number | null;
  niftyMidcap100NAV?: number | null;
  niftySmallcap250NAV?: number | null;
}) {
  return {
    totalEquity: roundEquity(snapshot.totalEquity),
    investedCapital: roundEquity(snapshot.investedCapital),
    portfolioNAV: roundPrice(snapshot.portfolioNAV),
    niftyNAV: snapshot.niftyNAV != null ? roundPrice(snapshot.niftyNAV) : null,
    units: roundQuantity(snapshot.units),
    cashflow: snapshot.cashflow != null ? roundEquity(snapshot.cashflow) : null,
    dailyPnL: snapshot.dailyPnL != null ? roundEquity(snapshot.dailyPnL) : null,
    dailyReturn: snapshot.dailyReturn != null ? roundPercent(snapshot.dailyReturn) : null,
    drawdown: snapshot.drawdown != null ? roundPercent(snapshot.drawdown) : null,
    navMA200: snapshot.navMA200 != null ? roundPrice(snapshot.navMA200) : null,
    nifty500Momentum50NAV: snapshot.nifty500Momentum50NAV != null ? roundPrice(snapshot.nifty500Momentum50NAV) : null,
    niftyMicrocap250NAV: snapshot.niftyMicrocap250NAV != null ? roundPrice(snapshot.niftyMicrocap250NAV) : null,
    niftyMidcap100NAV: snapshot.niftyMidcap100NAV != null ? roundPrice(snapshot.niftyMidcap100NAV) : null,
    niftySmallcap250NAV: snapshot.niftySmallcap250NAV != null ? roundPrice(snapshot.niftySmallcap250NAV) : null,
  };
}
