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
  periodToString,
  stringToPeriod,
  getPreviousPeriod,
  getAMFIPeriodStatus,
  
  // Category lookups
  getCategory,
  getCategoriesBatch,
  
  // Excel processing
  parseExcel,
  
  // Database sync
  syncToDatabase,
  recalculateAffectedSnapshots,
  
  // Public API
  uploadClassification,
  getAvailablePeriods,
  hasPeriodData,
} from './service';
