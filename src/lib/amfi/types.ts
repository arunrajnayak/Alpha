/**
 * AMFI Classification Types
 */

export type AMFICategory = 'Large' | 'Mid' | 'Small' | 'Micro';
export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro';

export interface AMFIPeriod {
  year: number;
  halfYear: 'H1' | 'H2'; // H1 = Jan-Jun, H2 = Jul-Dec
}

export interface AMFIStockClassification {
  rank: number;
  companyName: string;
  symbol: string;
  isin: string;
  category: AMFICategory;
  avgMarketCap: number; // in Crores
}

export interface AMFIPeriodStatus {
  currentPeriod: string;
  applicablePeriod: string;
  hasData: boolean;
  isMissing: boolean;
  isUsingFallback: boolean;
  message: string;
}

export interface AMFISyncResult {
  period: string;
  created: number;
  updated: number;
  total: number;
  affectedSnapshots?: number;
}
