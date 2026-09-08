'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import protobuf from 'protobufjs';
import { upstoxLogger } from '@/lib/logger';
import { isPreOpenSession } from '@/lib/market-status-utils';

// ============================================================================
// Types
// ============================================================================

export interface PriceUpdate {
  symbol: string;
  instrumentKey: string;
  ltp: number;
  previousClose: number;
  change: number;
  changePercent: number;
  iep?: number;
}

export type StreamStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseUpstoxStreamOptions {
  enabled?: boolean;
  onPriceUpdate?: (updates: PriceUpdate[]) => void;
  onStatusChange?: (status: StreamStatus) => void;
  onError?: (error: string) => void;
}

interface UseUpstoxStreamReturn {
  status: StreamStatus;
  lastUpdate: Date | null;
  priceMap: Map<string, PriceUpdate>;
  reconnect: () => void;
  disconnect: () => void;
  subscribeToInstruments: (instruments: {instrumentKey: string, symbol: string}[]) => void;
}

interface AuthResponse {
  authorizedUrl: string;
  instrumentKeys: string[];
  symbolMap: Record<string, string>;
  indices: string[];
}

// Protobuf message types
interface FeedLTPC {
  ltp?: number;
  ltt?: number | Long;
  ltq?: number | Long;
  cp?: number;
  iep?: { value?: number } | number;
}

interface StatusInfo {
  status?: string;
  updatedTime?: number | Long;
}

interface MarketInfo {
  segmentStatus?: Record<string, number>;
  casMarketStatus?: Record<string, StatusInfo>;
  preOpenSessionStatus?: Record<string, StatusInfo>;
}

interface Feed {
  ltpc?: FeedLTPC;
  fullFeed?: {
    marketFF?: {
      ltpc?: FeedLTPC;
      iep?: number;
      rp?: number;
      ieq?: number | Long;
      casEligible?: boolean;
    };
    indexFF?: {
      ltpc?: FeedLTPC;
    };
  };
  firstLevelWithGreeks?: {
    ltpc?: FeedLTPC;
  };
  requestMode?: number;
}

interface FeedResponse {
  type?: number;
  feeds?: Record<string, Feed>;
  currentTs?: number | Long;
  marketInfo?: MarketInfo;
}

// Long type from protobufjs
interface Long {
  low: number;
  high: number;
  unsigned: boolean;
  toNumber(): number;
}

// ============================================================================
// Protobuf Schema (inline to avoid file loading issues)
// Must match: https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto
// ============================================================================

const PROTO_SCHEMA = `
syntax = "proto3";

message DoubleValue {
  double value = 1;
}

message LTPC {
  double ltp = 1;
  int64 ltt = 2;
  int64 ltq = 3;
  double cp = 4;
  DoubleValue iep = 5;
}

message MarketLevel {
  repeated Quote bidAskQuote = 1;
}

message MarketOHLC {
  repeated OHLC ohlc = 1;
}

message Quote {
  int64 bidQ = 1;
  double bidP = 2;
  int64 askQ = 3;
  double askP = 4;
}

message OptionGreeks {
  double delta = 1;
  double theta = 2;
  double gamma = 3;
  double vega = 4;
  double rho = 5;
}

message OHLC {
  string interval = 1;
  double open = 2;
  double high = 3;
  double low = 4;
  double close = 5;
  int64 vol = 6;
  int64 ts = 7;
}

enum Type {
  initial_feed = 0;
  live_feed = 1;
  market_info = 2;
}

message MarketFullFeed {
  LTPC ltpc = 1;
  MarketLevel marketLevel = 2;
  OptionGreeks optionGreeks = 3;
  MarketOHLC marketOHLC = 4;
  double atp = 5;
  int64 vtt = 6;
  double oi = 7;
  double iv = 8;
  double tbq = 9;
  double tsq = 10;
  double iep = 11;
  double rp = 12;
  int64 ieq = 13;
  int64 iiqTotal = 14;
  int64 iiqM = 15;
  bool casEligible = 16;
}

message IndexFullFeed {
  LTPC ltpc = 1;
  MarketOHLC marketOHLC = 2;
}

message FullFeed {
  oneof FullFeedUnion {
    MarketFullFeed marketFF = 1;
    IndexFullFeed indexFF = 2;
  }
}

message FirstLevelWithGreeks {
  LTPC ltpc = 1;
  Quote firstDepth = 2;
  OptionGreeks optionGreeks = 3;
  int64 vtt = 4;
  double oi = 5;
  double iv = 6;
}

message Feed {
  oneof FeedUnion {
    LTPC ltpc = 1;
    FullFeed fullFeed = 2;
    FirstLevelWithGreeks firstLevelWithGreeks = 3;
  }
  RequestMode requestMode = 4;
}

enum RequestMode {
  ltpc = 0;
  full_d5 = 1;
  option_greeks = 2;
  full_d30 = 3;
}

enum MarketStatus {
  PRE_OPEN_START = 0;
  PRE_OPEN_END = 1;
  NORMAL_OPEN = 2;
  NORMAL_CLOSE = 3;
  CLOSING_START = 4;
  CLOSING_END = 5;
}

message StatusInfo {
  string status = 1;
  int64 updatedTime = 2;
}

message MarketInfo {
  map<string, MarketStatus> segmentStatus = 1;
  map<string, StatusInfo> casMarketStatus = 2;
  map<string, StatusInfo> preOpenSessionStatus = 3;
}

message FeedResponse {
  Type type = 1;
  map<string, Feed> feeds = 2;
  int64 currentTs = 3;
  MarketInfo marketInfo = 4;
}
`;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useUpstoxStream(options: UseUpstoxStreamOptions = {}): UseUpstoxStreamReturn {
  const {
    enabled = true,
    onPriceUpdate,
    onStatusChange,
    onError,
  } = options;

  const [status, setStatus] = useState<StreamStatus>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [priceMap, setPriceMap] = useState<Map<string, PriceUpdate>>(new Map());

  // Accumulate price updates in a ref so the WS message handler never calls React setState
  // directly. A single requestAnimationFrame flushes all ticks received in the same frame.
  const priceMapRef = useRef<Map<string, PriceUpdate>>(new Map());
  const rafPendingRef = useRef(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const enabledRef = useRef(enabled);
  const symbolMapRef = useRef<Record<string, string>>({});
  const instrumentKeysRef = useRef<string[]>([]);
  const dynamicKeysRef = useRef<Set<string>>(new Set());
  const protoRootRef = useRef<protobuf.Root | null>(null);

  // Callback refs
  const onPriceUpdateRef = useRef(onPriceUpdate);
  const onStatusChangeRef = useRef(onStatusChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
    onStatusChangeRef.current = onStatusChange;
    onErrorRef.current = onError;
    enabledRef.current = enabled;
  }, [onPriceUpdate, onStatusChange, onError, enabled]);

  // Initialize Protobuf schema
  useEffect(() => {
    const { root } = protobuf.parse(PROTO_SCHEMA);
    protoRootRef.current = root;
  }, []);

  const updateStatus = useCallback((newStatus: StreamStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    upstoxLogger.error('Error:', errorMsg);
    onErrorRef.current?.(errorMsg);
  }, []);

  const decodeMessage = useCallback((data: ArrayBuffer): FeedResponse | null => {
    try {
      if (!protoRootRef.current) {
        upstoxLogger.warn('Protobuf root not initialized');
        return null;
      }

      const FeedResponseType = protoRootRef.current.lookupType('FeedResponse');
      const decoded = FeedResponseType.decode(new Uint8Array(data));
      return decoded as unknown as FeedResponse;
    } catch (error) {
      upstoxLogger.error('Failed to decode message:', error);
      return null;
    }
  }, []);

  const processMessage = useCallback((message: FeedResponse) => {
    // Type enum: 0 = initial_feed, 1 = live_feed, 2 = market_info
    if ((message.type === 1 || message.type === 0) && message.feeds) {
      const updates: PriceUpdate[] = [];

      for (const [key, feed] of Object.entries(message.feeds)) {
        // Feed uses oneof FeedUnion - can be ltpc, fullFeed, or firstLevelWithGreeks
        let ltpc: FeedLTPC | undefined;
        let ffIep: number | undefined;

        if (feed.ltpc) {
          // Direct LTPC mode
          ltpc = feed.ltpc;
        } else if (feed.fullFeed) {
          // Full feed mode - can be marketFF or indexFF
          if (feed.fullFeed.marketFF?.ltpc) {
            ltpc = feed.fullFeed.marketFF.ltpc;
            ffIep = feed.fullFeed.marketFF.iep;
          } else if (feed.fullFeed.indexFF?.ltpc) {
            ltpc = feed.fullFeed.indexFF.ltpc;
          }
        } else if (feed.firstLevelWithGreeks?.ltpc) {
          // First level with greeks mode
          ltpc = feed.firstLevelWithGreeks.ltpc;
        }

        if (!ltpc) continue;

        const symbol = symbolMapRef.current[key] 
          || symbolMapRef.current[key.replace(/:/g, '|')]
          || symbolMapRef.current[key.replace(/\|/g, ':')];
        if (!symbol) continue;

        // Parse IEP (Indicative Equilibrium Price) if present
        let rawIep: number | undefined = ffIep;
        if (ltpc.iep !== undefined && ltpc.iep !== null) {
          rawIep = typeof ltpc.iep === 'object' && 'value' in ltpc.iep ? ltpc.iep.value : Number(ltpc.iep);
        }
        const iep = rawIep && rawIep > 0 ? rawIep : undefined;

        // In pre-open / CAS session, or if continuous trades haven't begun (ltp === 0),
        // IEP is the discovered equilibrium price
        const isPreOpen = isPreOpenSession();
        const effectiveLtp = (isPreOpen && iep) ? iep : ((ltpc.ltp && ltpc.ltp > 0) ? ltpc.ltp : (iep || 0));
        const previousClose = ltpc.cp || effectiveLtp;
        const change = effectiveLtp - previousClose;
        const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

        updates.push({
          symbol,
          instrumentKey: key,
          ltp: effectiveLtp,
          previousClose,
          change,
          changePercent,
          iep,
        });
      }

      if (updates.length > 0) {
        // Accumulate into ref — zero React work in the message event handler
        for (const update of updates) {
          priceMapRef.current.set(update.symbol, update);
        }
        // One RAF per frame: flush ref → state for any direct hook consumers
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          requestAnimationFrame(() => {
            rafPendingRef.current = false;
            setPriceMap(new Map(priceMapRef.current));
            setLastUpdate(new Date());
          });
        }
        // Notify context/subscribers immediately (they do their own batching)
        onPriceUpdateRef.current?.(updates);
      }
    } else if (message.type === 2 && message.marketInfo) {
      upstoxLogger.info('Market info update:', message.marketInfo);
    }
  }, []);

  const subscribe = useCallback((ws: WebSocket) => {
    // Combine base keys and dynamic keys, filter out empty strings
    const allKeys = Array.from(new Set([
      ...instrumentKeysRef.current,
      ...Array.from(dynamicKeysRef.current)
    ])).filter(Boolean);

    if (allKeys.length === 0) return;

    const subscribeMessage = {
      guid: `portfolio-${Date.now()}`,
      method: 'sub',
      data: {
        mode: 'ltpc',
        instrumentKeys: allKeys,
      },
    };

    // Send as binary (required by Upstox V3)
    const encoder = new TextEncoder();
    ws.send(encoder.encode(JSON.stringify(subscribeMessage)));
    upstoxLogger.info(`Subscribed to ${allKeys.length} instruments`);
  }, []);

  const subscribeToInstruments = useCallback((instruments: {instrumentKey: string, symbol: string}[]) => {
    let addedNew = false;
    for (const inst of instruments) {
      if (inst.instrumentKey && !dynamicKeysRef.current.has(inst.instrumentKey)) {
        dynamicKeysRef.current.add(inst.instrumentKey);
        symbolMapRef.current[inst.instrumentKey] = inst.symbol;
        addedNew = true;
      }
    }

    // Only resubscribe if actual new keys were added and connection is open
    if (addedNew && wsRef.current?.readyState === WebSocket.OPEN) {
      subscribe(wsRef.current);
    }
  }, [subscribe]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    updateStatus('connecting');

    try {
      // Fetch authorization URL and instrument mappings
      const response = await fetch('/api/stream/authorize');
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Auth failed: ${response.status}`);
      }

      const auth: AuthResponse = await response.json();
      
      symbolMapRef.current = auth.symbolMap;
      instrumentKeysRef.current = auth.instrumentKeys;

      // Also add reverse mapping for indices
      for (const indexKey of auth.indices) {
        if (!symbolMapRef.current[indexKey]) {
          // Extract index name from key (e.g., "NSE_INDEX|Nifty 50" -> "Nifty 50")
          const parts = indexKey.split('|');
          if (parts[1]) {
            symbolMapRef.current[indexKey] = parts[1];
          }
        }
      }

      upstoxLogger.info(`Connecting to Upstox WebSocket with ${auth.instrumentKeys.length} instruments`);

      const ws = new WebSocket(auth.authorizedUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        upstoxLogger.info('WebSocket connected');
        reconnectAttemptsRef.current = 0;
        updateStatus('connected');
        subscribe(ws);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const message = decodeMessage(event.data);
          if (message) {
            processMessage(message);
          }
        }
      };

      ws.onerror = (error) => {
        upstoxLogger.error('WebSocket error:', error);
        handleError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        upstoxLogger.info(`WebSocket closed: ${event.code} ${event.reason}`);
        wsRef.current = null;

        if (enabledRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          upstoxLogger.info(`Reconnecting in ${delay}ms...`);
          updateStatus('reconnecting');

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else {
          updateStatus('disconnected');
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect';
      handleError(message);
      updateStatus('error');

      // Don't retry on auth errors
      if (!message.includes('token') && !message.includes('401')) {
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      }
    }
  }, [updateStatus, handleError, decodeMessage, processMessage, subscribe]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    updateStatus('disconnected');
  }, [updateStatus]);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [disconnect, connect]);

  // Main effect
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    status,
    lastUpdate,
    priceMap,
    reconnect,
    disconnect,
    subscribeToInstruments,
  };
}

// Re-export types for backward compatibility
export type { PriceUpdate as ServerPriceUpdate };
