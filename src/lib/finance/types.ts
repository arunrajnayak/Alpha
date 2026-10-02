// ============================================================================
// TYPE DEFINITIONS - Finance Module
// ============================================================================

/** Stock quote data from various sources (Upstox, NSE, etc.) */
export interface StockQuote {
    date: Date;
    close: number;
    adjClose?: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
}

/** Stock split event data */
export interface SplitEvent {
    date: Date;
    numerator: number;
    denominator: number;
    ratio?: number;
}

/** Result from fetching stock history */
export interface StockHistoryResult {
    quotes: StockQuote[];
    events?: {
        splits?: SplitEvent[];
    };
}

/** Sector mapping from database */
export interface SectorMapping {
    symbol: string;
    sector: string;
    exchange?: string;
}

/** Request cache type for deduplicating API calls */
export type RequestCache = Map<string, Promise<StockHistoryResult | null>>;

export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro' | 'Nano';

export type ProgressCallback = (message: string, progress: number) => Promise<void> | void;

export type Holding = { symbol: string; currentValue: number };

export interface MarketCapResult {
    large: number;
    mid: number;
    small: number;
    micro: number;
    nano: number;
}
