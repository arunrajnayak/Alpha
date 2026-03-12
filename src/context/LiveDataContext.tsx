'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getLiveDashboardData, LiveDashboardData, LiveStockData, BreadthByCategory, saveIntradayPnL, getIntradayPnLHistory, IntradayPnLPoint } from '@/app/actions/live';
import { useUpstoxStream, PriceUpdate, StreamStatus } from '@/hooks/useUpstoxStream';

// Update interval in milliseconds (5 seconds)
const UPDATE_INTERVAL_MS = 5000;

// Re-export for component use
export type PnLHistoryPoint = IntradayPnLPoint;

export interface ConnectionError {
  type: 'token' | 'stream' | 'network' | 'unknown';
  message: string;
  timestamp: Date;
}

interface LiveDataContextType {
  data: LiveDashboardData | null;
  prevData: LiveDashboardData | null;
  loading: boolean;
  lastRefreshed: Date | null;
  refresh: () => Promise<void>;
  hasAnimatedInitial: boolean;
  setHasAnimatedInitial: (val: boolean) => void;
  showDynamicTitle: boolean;
  setShowDynamicTitle: (val: boolean) => void;
  // Streaming status
  streamStatus: StreamStatus;
  isStreaming: boolean;
  streamingEnabled: boolean;
  setStreamingEnabled: (val: boolean) => void;
  // Error handling
  connectionError: ConnectionError | null;
  clearConnectionError: () => void;
  // Intraday P/L history
  pnlHistory: PnLHistoryPoint[];
  // Shared WebSocket subscription
  subscribeToPrices: (callback: (updates: PriceUpdate[]) => void) => () => void;
  subscribeToInstruments: (instruments: {instrumentKey: string, symbol: string}[]) => void;
}

const LiveDataContext = createContext<LiveDataContextType | undefined>(undefined);

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<LiveDashboardData | null>(null);
  const [prevData, setPrevData] = useState<LiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [hasAnimatedInitial, setHasAnimatedInitial] = useState(false);
  const [showDynamicTitle, setShowDynamicTitleState] = useState(false);
  const [streamingEnabled, setStreamingEnabledState] = useState(true);
  const [connectionError, setConnectionError] = useState<ConnectionError | null>(null);
  const [pnlHistory, setPnlHistory] = useState<PnLHistoryPoint[]>([]);
  const isFetchingBus = useRef(false);
  const errorShownRef = useRef(false); // Prevent duplicate error toasts
  
  // Batched update refs - accumulate updates and apply every UPDATE_INTERVAL_MS
  const pendingUpdatesRef = useRef<Map<string, PriceUpdate>>(new Map());
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBatchAppliedRef = useRef<number>(0);
  const lastPnLSaveRef = useRef<number>(0);
  
  // Shared subscribers for other components (like MarketOverview)
  const priceSubscribersRef = useRef<Set<(updates: PriceUpdate[]) => void>>(new Set());

  const clearConnectionError = useCallback(() => {
    setConnectionError(null);
    errorShownRef.current = false;
  }, []);

  // Initialize preferences from localStorage on mount
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    const savedDynamicTitle = localStorage.getItem('showDynamicTitle');
    if (savedDynamicTitle !== null) {
      setShowDynamicTitleState(JSON.parse(savedDynamicTitle));
    }
    
    const savedStreaming = localStorage.getItem('streamingEnabled');
    if (savedStreaming !== null) {
      setStreamingEnabledState(JSON.parse(savedStreaming));
    }

    // Load P/L history from server
    getIntradayPnLHistory()
      .then(history => {
        if (history.length > 0) {
          setPnlHistory(history);
          console.log(`[LiveData] Loaded ${history.length} P/L history points from server`);
        }
      })
      .catch(err => console.error('[LiveData] Failed to load P/L history:', err));
  }, []);

  const setShowDynamicTitle = useCallback((val: boolean) => {
    setShowDynamicTitleState(val);
    localStorage.setItem('showDynamicTitle', JSON.stringify(val));
  }, []);

  const setStreamingEnabled = useCallback((val: boolean) => {
    setStreamingEnabledState(val);
    localStorage.setItem('streamingEnabled', JSON.stringify(val));
  }, []);

  // Monitor data changes to save P/L history periodically (throttled to 1 minute)
  useEffect(() => {
    if (!data || !data.dayGain && data.dayGain !== 0) return;

    const now = Date.now();
    // Only save if enough time passed since last save
    if (now - lastPnLSaveRef.current >= 60000) {
      // Use server-provided market status for reliability (handles special sessions/holidays)
      const isMarketOpen = data.marketStatus === 'OPEN';
      
      if (isMarketOpen) {
        lastPnLSaveRef.current = now;
        
        const currentPnl = data.dayGain;
        const currentPercent = data.dayGainPercent;
        
        saveIntradayPnL(currentPnl, currentPercent)
          .then(() => {
            const newPoint: PnLHistoryPoint = {
              time: new Date(),
              pnl: currentPnl,
              percent: currentPercent
            };
            setPnlHistory(prev => [...prev, newPoint]);
          })
          .catch(err => console.error('[LiveData] Failed to save P/L:', err));
      }
    }
  }, [data?.dayGain, data?.dayGainPercent]);

  // Track if we're in market hours based on actual server-side market status
  // This is updated from the live data response to support special sessions (like Sunday budget)
  const [isMarketHours, setIsMarketHours] = useState(() => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    // Initial guess: Monday-Friday, 9 AM to 4 PM IST
    return day >= 1 && day <= 5 && hour >= 9 && hour < 16;
  });

  // Apply batched updates to data
  const applyBatchedUpdates = useCallback(() => {
    const updates = pendingUpdatesRef.current;
    if (updates.size === 0) return;
    
    // Clear pending updates
    pendingUpdatesRef.current = new Map();
    lastBatchAppliedRef.current = Date.now();
    
    
    setData(currentData => {
      if (!currentData) return currentData;

      // Create a map of updates for quick lookup (by symbol)
      const updateMap = new Map<string, PriceUpdate>();
      for (const [key, update] of updates) {
        updateMap.set(key, update);
      }
      
      // Update allHoldings with new prices
      const updatedHoldings: LiveStockData[] = currentData.allHoldings.map(holding => {
        const update = updateMap.get(holding.symbol);
        if (!update) return holding;

        const ltp = update.ltp;
        
        // Guard against bad updates
        if (!ltp || ltp <= 0) return holding;

        const previousClose = holding.previousClose || ltp;
        
        const dayChange = ltp - previousClose;
        const dayChangePercent = previousClose > 0 ? (dayChange / previousClose) * 100 : 0;
        
        const currentValue = holding.quantity * ltp;
        
        const originalInvested = holding.invested;
        
        const totalPnl = currentValue - originalInvested;
        const totalPnlPercent = originalInvested > 0 ? (totalPnl / originalInvested) * 100 : 0;

        return {
          ...holding,
          currentPrice: ltp,
          previousClose: previousClose,
          dayChange: dayChange,
          dayChangePercent: dayChangePercent,
          currentValue: currentValue,
          totalPnl: totalPnl,
          totalPnlPercent: totalPnlPercent,
        };
      });

      // Update indices with new prices from stream
      // Build a lowercase lookup map for case-insensitive matching
      const updateMapLower = new Map<string, PriceUpdate>();
      for (const [, update] of updateMap) {
        updateMapLower.set(update.symbol.toLowerCase(), update);
      }
      
      const updatedIndices = currentData.indices.map(index => {
        // Try exact match first, then case-insensitive match
        let update = updateMap.get(index.name) || updateMap.get(index.symbol);
        
        if (!update) {
          // Try case-insensitive match on name
          update = updateMapLower.get(index.name.toLowerCase());
        }
        
        if (!update) {
          // Try to extract name from symbol (instrument key) and match
          // index.symbol might be "NSE_INDEX|Nifty 50"
          const parts = index.symbol.split('|');
          if (parts[1]) {
            update = updateMap.get(parts[1]) || updateMapLower.get(parts[1].toLowerCase());
          }
        }
        
        if (!update) return index;

        const ltp = update.ltp;
        if (!ltp || ltp <= 0) return index;

        const previousClose = update.previousClose || index.currentPrice;
        const change = ltp - previousClose;
        const percentChange = previousClose > 0 ? (change / previousClose) * 100 : 0;

        return {
          ...index,
          currentPrice: ltp,
          percentChange: percentChange,
        };
      });

      // Recalculate aggregates
      let totalEquity = 0;
      let totalPreviousEquity = 0;
      let totalInvested = 0;

      for (const holding of updatedHoldings) {
        const prevValue = holding.quantity * holding.previousClose;
        totalEquity += holding.currentValue;
        totalPreviousEquity += prevValue;
      }

      totalInvested = updatedHoldings.reduce((sum, h) => {
        return sum + (h.currentValue - h.totalPnl);
      }, 0);

      const dayGain = totalEquity - totalPreviousEquity;
      const dayGainPercent = totalPreviousEquity > 0 ? (dayGain / totalPreviousEquity) * 100 : 0;
      const totalPnl = totalEquity - totalInvested;
      const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

      // Calculate advances/declines
      const advances = updatedHoldings.filter(h => h.dayChange > 0).length;
      const declines = updatedHoldings.filter(h => h.dayChange < 0).length;

      // Calculate breadth by category
      const breadthByCategory: BreadthByCategory = {
        large: { advances: 0, declines: 0 },
        mid: { advances: 0, declines: 0 },
        small: { advances: 0, declines: 0 },
        micro: { advances: 0, declines: 0 }
      };

      for (const stock of updatedHoldings) {
        if (!stock.marketCapCategory) continue;
        const key = stock.marketCapCategory.toLowerCase() as 'large' | 'mid' | 'small' | 'micro';
        if (stock.dayChange > 0) {
          breadthByCategory[key].advances++;
        } else if (stock.dayChange < 0) {
          breadthByCategory[key].declines++;
        }
      }

      // Sort for movers
      const sortedByPercent = [...updatedHoldings].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
      const topGainers = sortedByPercent.slice(0, 5);
      const topLosers = sortedByPercent.slice(-5).reverse();

      // Update sector allocations with new values
      const sectorGroups = new Map<string, { value: number; count: number; weightedChange: number }>();
      for (const holding of updatedHoldings) {
        const sector = holding.sector || 'Unknown';
        const existing = sectorGroups.get(sector) || { value: 0, count: 0, weightedChange: 0 };
        existing.value += holding.currentValue;
        existing.count += 1;
        existing.weightedChange += holding.currentValue * holding.dayChangePercent;
        sectorGroups.set(sector, existing);
      }

      const validTotalEquity = totalEquity || 1;
      const sectorAllocations = Array.from(sectorGroups.entries()).map(([sector, sectorData]) => ({
        sector,
        value: sectorData.value,
        allocation: (sectorData.value / validTotalEquity) * 100,
        count: sectorData.count,
        dayChangePercent: sectorData.value > 0 ? sectorData.weightedChange / sectorData.value : 0
      })).sort((a, b) => b.allocation - a.allocation);

      return {
        ...currentData,
        totalEquity,
        totalInvested,
        totalPnl,
        totalPnlPercent,
        dayGain,
        dayGainPercent,
        advances,
        declines,
        breadthByCategory,
        allHoldings: sortedByPercent,
        topGainers,
        topLosers,
        sectorAllocations,
        indices: updatedIndices,
        lastUpdated: new Date().toISOString(),
      };
    });



    setLastRefreshed(new Date());
  }, []);

  // Handle price updates from WebSocket - batch them for less frequent UI updates
  const handlePriceUpdate = useCallback((updates: PriceUpdate[]) => {
    // Accumulate updates in the pending map (latest update wins for each symbol)
    for (const update of updates) {
      pendingUpdatesRef.current.set(update.symbol, update);
      if (update.instrumentKey) {
        pendingUpdatesRef.current.set(update.instrumentKey, update);
      }
    }
    
    // Schedule batch application if not already scheduled
    const now = Date.now();
    const timeSinceLastBatch = now - lastBatchAppliedRef.current;
    
    if (!updateTimerRef.current) {
      // Calculate when to apply: either immediately if enough time passed, or schedule for later
      const delay = timeSinceLastBatch >= UPDATE_INTERVAL_MS ? 0 : UPDATE_INTERVAL_MS - timeSinceLastBatch;
      
      updateTimerRef.current = setTimeout(() => {
        updateTimerRef.current = null;
        applyBatchedUpdates();
      }, delay);
    }
    
    // Also notify any registered external subscribers immediately (or let them batch themselves)
    priceSubscribersRef.current.forEach(callback => {
      try {
        callback(updates);
      } catch (err) {
        console.error('[LiveData] Error in price subscriber:', err);
      }
    });
  }, [applyBatchedUpdates]);
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  // Handle stream status changes
  const handleStreamStatusChange = useCallback((status: StreamStatus) => {
    console.log('[LiveData] Stream status:', status);
    
    // Clear error when connected
    if (status === 'connected') {
      setConnectionError(null);
      errorShownRef.current = false;
    }
  }, []);

  // Handle stream errors
  const handleStreamError = useCallback((errorMsg: string) => {
    // Don't log 403 errors repeatedly - they're expected when market is closed or token issues
    const is403Error = errorMsg.includes('403');
    if (!is403Error) {
      console.error('[LiveData] Stream error:', errorMsg);
    }
    
    // Only show error once per session to avoid spam
    if (!errorShownRef.current) {
      errorShownRef.current = true;
      
      // Detect error type
      let errorType: ConnectionError['type'] = 'unknown';
      if (errorMsg.toLowerCase().includes('token') || errorMsg.toLowerCase().includes('401')) {
        errorType = 'token';
      } else if (errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('fetch')) {
        errorType = 'network';
      } else if (is403Error) {
        // 403 errors are often temporary - don't show as critical error
        errorType = 'stream';
      } else {
        errorType = 'stream';
      }
      
      // For 403 errors, use a friendlier message
      const displayMessage = is403Error 
        ? 'Live streaming unavailable. Using polling for updates.'
        : errorMsg;
      
      setConnectionError({
        type: errorType,
        message: displayMessage,
        timestamp: new Date(),
      });
    }
  }, []);

  const [isVisible, setIsVisible] = useState(true);

  // Use Upstox stream hook for direct WebSocket connection
  const { status: streamStatus, subscribeToInstruments } = useUpstoxStream({
    enabled: isVisible && streamingEnabled && isMarketHours && !!data?.tokenStatus?.hasToken,
    onPriceUpdate: handlePriceUpdate,
    onStatusChange: handleStreamStatusChange,
    onError: handleStreamError,
  });

  const isStreaming = streamStatus === 'connected';

  const refresh = useCallback(async () => {
    if (isFetchingBus.current) return;
    
    isFetchingBus.current = true;
    try {
      const result = await getLiveDashboardData();
      setData(current => {
        if (current) setPrevData(current);
        return result;
      });
      setLastRefreshed(new Date());
      
      // Update market hours based on actual server response
      // This ensures streaming works during special sessions (like Sunday budget day)
      setIsMarketHours(result.marketStatus === 'OPEN');
      
      // Check token status from the result
      if (result.tokenStatus && !result.tokenStatus.hasToken && !errorShownRef.current) {
        errorShownRef.current = true;
        setConnectionError({
          type: 'token',
          message: result.tokenStatus.message || 'No valid Upstox token. Please login to connect.',
          timestamp: new Date(),
        });
      } else if (result.tokenStatus?.hasToken) {
        // Clear error if token is now valid
        setConnectionError(null);
        errorShownRef.current = false;
      }
    } catch (error) {
      console.error('Failed to fetch live data:', error);
      
      // Show error toast for fetch failures
      if (!errorShownRef.current) {
        errorShownRef.current = true;
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch data';
        
        let errorType: ConnectionError['type'] = 'network';
        if (errorMessage.toLowerCase().includes('token')) {
          errorType = 'token';
        }
        
        setConnectionError({
          type: errorType,
          message: errorMessage,
          timestamp: new Date(),
        });
      }
    } finally {
      setLoading(false);
      isFetchingBus.current = false;
    }
  }, []);

  // Ref to track market status without causing effect re-runs
  const marketStatusRef = useRef(data?.marketStatus);
  useEffect(() => {
    marketStatusRef.current = data?.marketStatus;
  }, [data?.marketStatus]);

  useEffect(() => {
    // Initial fetch (always needed to get full data including indices, sectors, etc.)
    refresh();

    // Polling logic - only poll when NOT streaming
    // When streaming is active, we only do a full refresh every 5 minutes for indices/sector data
    const getMsUntilNextSync = () => {
      const now = new Date();
      const seconds = now.getSeconds();
      const ms = now.getMilliseconds();
      const targetSeconds = seconds < 30 ? 30 : 60;
      return ((targetSeconds - seconds) * 1000) - ms;
    };

    // Use server-provided market status via ref (avoids effect churn)
    const isMarketCurrentlyOpen = () => marketStatusRef.current === 'OPEN';

    let timeoutId: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;

    const scheduleSync = () => {
      const msUntilNext = getMsUntilNextSync();
      
      timeoutId = setTimeout(() => {
        // If streaming is connected, do less frequent full refreshes (every 5 minutes)
        // If not streaming, poll every 30 seconds
        const pollInterval = isStreaming ? 300000 : 30000; // 5 min vs 30 sec

        if (isMarketCurrentlyOpen()) {
          if (!isStreaming) {
            refresh();
          }
        }

        intervalId = setInterval(() => {
          if (isMarketCurrentlyOpen()) {
            if (!isStreaming) {
              refresh();
            }
          }
        }, pollInterval);
      }, msUntilNext);
    };

    scheduleSync();

    // Also set up a less frequent refresh for indices even when streaming
    let indicesIntervalId: NodeJS.Timeout | null = null;
    if (isStreaming) {
      indicesIntervalId = setInterval(() => {
        if (isMarketCurrentlyOpen()) {
          refresh();
        }
      }, 300000); // Every 5 minutes
    }

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      if (indicesIntervalId) clearInterval(indicesIntervalId);
    };
  }, [refresh, isStreaming]);

  const subscribeToPrices = useCallback((callback: (updates: PriceUpdate[]) => void) => {
    priceSubscribersRef.current.add(callback);
    return () => {
      priceSubscribersRef.current.delete(callback);
    };
  }, []);

  return (
    <LiveDataContext.Provider value={{
      data, 
      prevData, 
      loading, 
      lastRefreshed, 
      refresh, 
      hasAnimatedInitial, 
      setHasAnimatedInitial,
      showDynamicTitle,
      setShowDynamicTitle,
      streamStatus,
      isStreaming,
      streamingEnabled,
      setStreamingEnabled,
      connectionError,
      clearConnectionError,
      pnlHistory,
      subscribeToPrices,
      subscribeToInstruments,
    }}>
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData() {
  const context = useContext(LiveDataContext);
  if (context === undefined) {
    throw new Error('useLiveData must be used within a LiveDataProvider');
  }
  return context;
}
