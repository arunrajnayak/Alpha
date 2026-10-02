/**
 * AMFI Classification Module
 *
 * Usage:
 *   import { getCategory, getCategoriesBatch, getAMFIPeriodStatus } from '@/lib/amfi';
 */

export * from './types';

export {
  // Period calculations
  getApplicablePeriod,
  getApplicablePeriod as getCurrentAMFIPeriod,
  periodToString,
  stringToPeriod,
  getPreviousPeriod,
  getAMFIPeriodStatus,

  // Category lookups
  getCategory,
  getCategoriesBatch,
  getCategoriesBatch as getAMFICategoriesBatch,

  // Utility functions
  mapAMFIToMarketCapCategory,
  resolveCapCategory,
  getSymbolResolver,

  // Excel processing
  parseExcel,
  parseExcel as parseAMFIExcel,

  // Database sync
  syncToDatabase,
  syncToDatabase as syncAMFIClassifications,
  recalculateAffectedSnapshots,

  // Download & full sync
  getAMFIPossibleUrls,
  getAMFIDownloadUrl,
  downloadAMFIData,
  getAMFIClassifications,
  fullAMFISync,

  // Public API
  uploadClassification,
  getAvailablePeriods,
  getAvailablePeriods as getAvailableAMFIPeriods,
  hasPeriodData,
  hasPeriodData as hasAMFIData,
} from './service';
