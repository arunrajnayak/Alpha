'use client';

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { 
  fetchPortfolioHoldings, 
  fetchHistoricalHoldings,
  fetchDashboardData,
  fetchTransactions,
  fetchSymbolMappings,
  fetchPortfolioExits,
  fetchDailySnapshots,
  fetchWeeklySnapshots
} from '@/app/actions/queries';

// Query key factories for consistency
export const queryKeys = {
  portfolio: {
    all: ['portfolio'] as const,
    holdings: () => [...queryKeys.portfolio.all, 'holdings'] as const,
    historical: () => [...queryKeys.portfolio.all, 'historical'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    data: () => [...queryKeys.dashboard.all, 'data'] as const,
  },
  trades: {
    all: ['trades'] as const,
    transactions: () => [...queryKeys.trades.all, 'transactions'] as const,
    mappings: () => [...queryKeys.trades.all, 'mappings'] as const,
  },
  exits: {
    all: ['exits'] as const,
    list: () => [...queryKeys.exits.all, 'list'] as const,
  },
  snapshots: {
    all: ['snapshots'] as const,
    daily: () => [...queryKeys.snapshots.all, 'daily'] as const,
    weekly: () => [...queryKeys.snapshots.all, 'weekly'] as const,
  },
};

// ============== Portfolio Hooks ==============

export function usePortfolioHoldings(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchPortfolioHoldings>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.portfolio.holdings(),
    queryFn: fetchPortfolioHoldings,
    staleTime: 60 * 1000, // 1 minute
    ...options,
  });
}

export function useHistoricalHoldings(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchHistoricalHoldings>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.portfolio.historical(),
    queryFn: fetchHistoricalHoldings,
    staleTime: 60 * 1000,
    ...options,
  });
}

// ============== Dashboard Hooks ==============

export function useDashboardData(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchDashboardData>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.dashboard.data(),
    queryFn: fetchDashboardData,
    staleTime: 60 * 1000,
    ...options,
  });
}

// ============== Trades Hooks ==============

export function useTransactions(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchTransactions>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.trades.transactions(),
    queryFn: fetchTransactions,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useSymbolMappings(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchSymbolMappings>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.trades.mappings(),
    queryFn: fetchSymbolMappings,
    staleTime: 5 * 60 * 1000, // 5 minutes - less frequently changed
    ...options,
  });
}

// ============== Exits Hooks ==============

export function usePortfolioExits(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchPortfolioExits>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.exits.list(),
    queryFn: fetchPortfolioExits,
    staleTime: 60 * 1000,
    ...options,
  });
}

// ============== Snapshot Hooks ==============

export function useDailySnapshots(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchDailySnapshots>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.snapshots.daily(),
    queryFn: fetchDailySnapshots,
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

export function useWeeklySnapshots(options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchWeeklySnapshots>>>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.snapshots.weekly(),
    queryFn: fetchWeeklySnapshots,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}
