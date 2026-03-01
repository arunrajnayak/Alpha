export interface UpstoxLTPC {
    ltp: number;
    ltt: string;
    ltq: string;
    cp: number;
}

export interface UpstoxOHLC {
    interval: string;
    open: number;
    high: number;
    low: number;
    close: number;
    vol: string;
    ts: string;
}

export interface UpstoxMarketFF {
    ltpc: UpstoxLTPC;
    marketOHLC?: {
        ohlc: UpstoxOHLC[];
    };
    atp?: number;
    vtt?: string;
    oi?: number;
    tbq?: number;
    tsq?: number;
}

export interface UpstoxFeedData {
    ltpc?: UpstoxLTPC;
    ff?: {
        marketFF: UpstoxMarketFF;
    };
}

export interface UpstoxFeedResponse {
    type: string;
    feeds?: Record<string, UpstoxFeedData>;
    currentTs?: string;
    marketInfo?: {
        segmentStatus?: Record<string, string>;
    };
}
