/**
 * Upstox API Types
 * 
 * Type definitions for all Upstox API responses and internal data structures.
 */

// ============================================================================
// Quote Types
// ============================================================================

export interface UpstoxLiveQuote {
  last_price: number;
  instrument_token: string;
  previous_close: number;
  timestamp?: number;
}

export interface UpstoxFullQuote {
  instrument_token: string;
  symbol: string;
  last_price: number;
  volume: number;
  average_price: number;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  net_change: number;
  total_buy_quantity: number;
  total_sell_quantity: number;
  lower_circuit_limit: number;
  upper_circuit_limit: number;
  last_trade_time: string;
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
}

export interface UpstoxCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ============================================================================
// Market Info Types
// ============================================================================

export interface MarketIndex {
  name: string;
  symbol: string;
  percentChange: number;
  currentPrice: number;
}

export interface MarketHoliday {
  date: string; // YYYY-MM-DD
  description: string;
  holiday_type: 'TRADING_HOLIDAY' | 'SETTLEMENT_HOLIDAY' | 'SPECIAL_TIMING';
  closed_exchanges: string[];
  open_exchanges: {
    exchange: string;
    start_time: number;
    end_time: number;
  }[];
}

export interface MarketTiming {
  exchange: string;
  start_time: number;
  end_time: number;
}

export type CASStatus = 'CTS_CLOSE' | 'CAS_LM_START' | 'CAS_M_STOP' | 'CAS_STOP' | 'NORMAL_CLOSE' | string;

export interface CASEligibleStatus {
  status: CASStatus;
  last_updated: number;
}

export interface UpstoxExchangeStatus {
  exchange: string;
  status: 'NORMAL_OPEN' | 'NORMAL_CLOSE' | 'SUNSET' | string;
  cas_eligible_status?: CASEligibleStatus;
  last_updated?: number;
}

// ============================================================================
// Token Types
// ============================================================================

export interface TokenStatus {
  hasToken: boolean;
  isAnalyticsToken: boolean;
  expiresAt: Date | null;
  hoursRemaining: number | null;
  isExpiringSoon: boolean;
  statusMessage: string;
}

// ============================================================================
// API Response Types (for internal use)
// ============================================================================

/**
 * Raw LTP response value from Upstox API
 */
export interface LTPResponseValue {
  last_price: number;
  instrument_token?: string;
  cp?: number; // previous close
  ltt?: string; // last trade time
}

/**
 * Raw OHLC response value from Upstox API
 */
export interface OHLCResponseValue {
  live_ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  prev_ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

// ============================================================================
// Instrument Types
// ============================================================================

export interface InstrumentData {
  instrument_key: string;
  exchange_token: string;
  trading_symbol: string;
  name: string;
  instrument_type: string;
  isin?: string;
  lot_size: number;
  tick_size: number;
  exchange: string;
  cas_eligible?: boolean;
}

// ============================================================================
// Historical Data Interval Types
// ============================================================================

export type HistoricalInterval = '1minute' | '5minute' | '30minute' | 'day' | 'week' | 'month';
export type OHLCInterval = '1d' | 'I1' | 'I30';

// ============================================================================
// WebSocket Feed Types (for client-side usage)
// ============================================================================

export interface FeedLTPC {
  ltp: number;
  ltt: string;
  ltq: string;
  cp: number;
}

export interface FeedOHLC {
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
  ts: string;
}

export interface FeedMarketFF {
  ltpc: FeedLTPC;
  marketOHLC?: {
    ohlc: FeedOHLC[];
  };
  atp?: number;
  vtt?: string;
  oi?: number;
  tbq?: number;
  tsq?: number;
}

export interface FeedFullFeed {
  marketFF?: FeedMarketFF;
}

export interface FeedData {
  ltpc?: FeedLTPC;
  fullFeed?: FeedFullFeed;
}

export interface FeedResponse {
  type: 'live_feed' | 'market_info';
  feeds?: Record<string, FeedData>;
  currentTs?: string;
  marketInfo?: {
    segmentStatus: Record<string, string>;
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface UpstoxAPIResponse<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export class UpstoxError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'UpstoxError';
  }
}

export class TokenExpiredError extends UpstoxError {
  constructor(expiredAt: Date) {
    const hoursAgo = (Date.now() - expiredAt.getTime()) / (1000 * 60 * 60);
    super(
      `Upstox token expired ${hoursAgo.toFixed(1)} hours ago. Set UPSTOX_ANALYTICS_TOKEN in your environment variables.`,
      401,
      'TOKEN_EXPIRED'
    );
    this.name = 'TokenExpiredError';
  }
}

export class NoTokenError extends UpstoxError {
  constructor() {
    super(
      'No Upstox token found. Set UPSTOX_ANALYTICS_TOKEN in your environment variables.',
      401,
      'NO_TOKEN'
    );
    this.name = 'NoTokenError';
  }
}
