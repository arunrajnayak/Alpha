import 'server-only';

import { prisma } from '@/lib/db';
import { fetchNSECorporateActions } from '@/lib/nse-api';
import { getCorporateActionsByISIN, UpstoxCorporateActionEvent } from '@/lib/upstox-client';
import { getInstrumentData } from '@/lib/instrument-service';
import { subDays, addDays, format } from 'date-fns';
import { triggerRecalculatePortfolio } from '@/app/actions';
import { parseNSEDateToStr } from '@/lib/format';
import { logger } from '@/lib/logger';

const corpActionsLogger = logger.scope('CorpActions');

// ============================================================================
// Types
// ============================================================================

export interface CorporateActionResult {
  success: boolean;
  message: string;
  actionsAdded: number;
  details?: string[];
}

// ============================================================================
// Parsing Logic
// ============================================================================

function parseCleanFloat(val: string | undefined): number {
  if (!val) return NaN;
  const match = val.match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}

/**
 * Converts "DD MMM YYYY", "DD Month YYYY", or "YYYY-MM-DD" to standard ISO "YYYY-MM-DD"
 */
export function parseDateStrToISO(dateStr: string): string | null {
  if (!dateStr || dateStr === '-') return null;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);

  const match = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;

  const day = match[1].padStart(2, '0');
  const monthKey = match[2].toLowerCase().slice(0, 3);
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month = monthMap[monthKey];
  if (!month) return null;

  return `${match[3]}-${month}-${day}`;
}

/**
 * Parse an Upstox Corporate Action event to extract action type, ratio multiplier, and ex-date
 */
export function parseUpstoxCorporateAction(event: UpstoxCorporateActionEvent): {
  type: 'SPLIT' | 'BONUS' | null;
  ratio: number;
  dateStr: string | null;
} {
  const eventName = (event.name || '').toLowerCase();

  // Find ex-date from event_details or fallback to expiry_date
  let rawDate = event.expiry_date;
  if (event.event_details) {
    const exDateDetail = event.event_details.find(d =>
      /ex\s+(split|bonus|dividend)\s+date/i.test(d.name)
    );
    if (exDateDetail?.value) rawDate = exDateDetail.value;
  }
  const dateStr = parseDateStrToISO(rawDate);

  if (eventName === 'split') {
    // 1. Check event_details for Old face value & New face value
    if (event.event_details) {
      const oldFvDetail = event.event_details.find(d => /old\s+face\s+value/i.test(d.name));
      const newFvDetail = event.event_details.find(d => /new\s+face\s+value/i.test(d.name));
      if (oldFvDetail && newFvDetail) {
        const oldVal = parseCleanFloat(oldFvDetail.value);
        const newVal = parseCleanFloat(newFvDetail.value);
        if (oldVal > 0 && newVal > 0 && oldVal > newVal) {
          return { type: 'SPLIT', ratio: oldVal / newVal, dateStr };
        }
      }
    }

    // 2. Fallback to event.ratio (e.g. '5:10' or '1:2')
    if (event.ratio) {
      const ratioMatch = event.ratio.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
      if (ratioMatch) {
        const num1 = parseFloat(ratioMatch[1]);
        const num2 = parseFloat(ratioMatch[2]);
        if (num1 > 0 && num2 > 0) {
          const max = Math.max(num1, num2);
          const min = Math.min(num1, num2);
          if (max > min) {
            return { type: 'SPLIT', ratio: max / min, dateStr };
          }
        }
      }
    }
    return { type: null, ratio: 1, dateStr };
  }

  if (eventName === 'bonus') {
    if (event.ratio) {
      // Bonus X:Y means X additional shares for every Y held -> multiplier = (X / Y) + 1
      const ratioMatch = event.ratio.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
      if (ratioMatch) {
        const newShares = parseFloat(ratioMatch[1]);
        const existingShares = parseFloat(ratioMatch[2]);
        if (newShares > 0 && existingShares > 0) {
          const ratio = (newShares / existingShares) + 1;
          if (ratio > 1) {
            return { type: 'BONUS', ratio, dateStr };
          }
        }
      }
    }
    return { type: null, ratio: 1, dateStr };
  }

  return { type: null, ratio: 1, dateStr };
}

/**
 * Parse NSE corporate action subject to extract type and ratio (legacy fallback)
 * 
 * Examples:
 * - "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share" → SPLIT, ratio 5
 * - "Bonus issue 1:1" → BONUS, ratio 2
 * - "Dividend - Rs 5 Per Share" → null (not a split/bonus)
 */
function parseSplitBonusRatio(subject: string): { type: 'SPLIT' | 'BONUS' | null; ratio: number } {
  const subjectLower = subject.toLowerCase();

  // Ignore non-equity bonus issues like NCRPS (Non-Convertible Redeemable Preference Shares), debentures, warrants, etc.
  if (
    subjectLower.includes('ncrps') ||
    subjectLower.includes('preference') ||
    subjectLower.includes('debenture') ||
    subjectLower.includes('warrant')
  ) {
    return { type: null, ratio: 1 };
  }
  
  // Pattern for Face Value Split: "From Rs X/- ... To Rs Y/-"
  const splitMatch = subjectLower.match(/face value split.*from rs\.?\s*(\d+(?:\.\d+)?)\s*\/?-?\s*(?:per share)?\s*to rs\.?\s*(\d+(?:\.\d+)?)/i);
  if (splitMatch) {
    const oldFaceValue = parseFloat(splitMatch[1]);
    const newFaceValue = parseFloat(splitMatch[2]);
    if (newFaceValue > 0 && oldFaceValue > newFaceValue) {
      const ratio = oldFaceValue / newFaceValue;
      return { type: 'SPLIT', ratio };
    }
  }
  
  // Alternative split pattern: "Stock Split X:Y" or "Split X:Y"
  const splitRatioMatch = subjectLower.match(/(?:stock\s+)?split.*?(\d+)\s*:\s*(\d+)/i);
  if (splitRatioMatch) {
    const newShares = parseInt(splitRatioMatch[1]);
    const oldShares = parseInt(splitRatioMatch[2]);
    if (oldShares > 0) {
      const ratio = newShares / oldShares;
      if (ratio > 1) {
        return { type: 'SPLIT', ratio };
      }
    }
  }
  
  // Pattern for Bonus: "Bonus X:Y" or "Bonus issue X:Y"
  const bonusMatch = subjectLower.match(/bonus.*?(\d+)\s*:\s*(\d+)/i);
  if (bonusMatch) {
    const newShares = parseInt(bonusMatch[1]);
    const oldShares = parseInt(bonusMatch[2]);
    if (oldShares > 0) {
      // Bonus 1:1 means 1 new share for every 1 held, so total becomes 2x
      const ratio = (newShares / oldShares) + 1;
      return { type: 'BONUS', ratio };
    }
  }
  
  return { type: null, ratio: 1 };
}

// ============================================================================
// Corporate Action Management
// ============================================================================

/**
 * Add a corporate action to the database
 * 
 * @param symbol - Stock symbol
 * @param date - Date of the corporate action (YYYY-MM-DD format)
 * @param type - Type of action (SPLIT or BONUS)
 * @param ratio - Split/bonus ratio (e.g., 2 for 2:1 split, 2 for 1:1 bonus)
 */
export async function addCorporateAction(
  symbol: string,
  date: string,
  type: 'SPLIT' | 'BONUS',
  ratio: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanDateStr = date.slice(0, 10);
    const actionDate = new Date(cleanDateStr + 'T00:00:00.000Z');
    const normalizedSymbol = symbol.toUpperCase();
    
    // Check for existing action within +/- 12 hours (handles UTC vs IST midnight)
    const existing = await prisma.transaction.findFirst({
      where: {
        symbol: normalizedSymbol,
        type,
        date: {
          gte: new Date(actionDate.getTime() - 12 * 3600 * 1000),
          lte: new Date(actionDate.getTime() + 12 * 3600 * 1000),
        }
      }
    });
    
    if (existing) {
      return { success: false, error: 'Corporate action already exists for this date' };
    }
    
    // Create the corporate action transaction
    // Store ratio in splitRatio field (used by PortfolioEngine.processTransaction)
    await prisma.transaction.create({
      data: {
        date: actionDate,
        symbol: normalizedSymbol,
        type,
        quantity: 0,
        price: 0,
        splitRatio: ratio, // Used by PortfolioEngine for split/bonus calculations
        orderId: `CORP-${normalizedSymbol}-${date}-${type}-${ratio}`,
        importBatchId: null
      }
    });
    
    corpActionsLogger.info(`Added ${type} ${ratio}:1 for ${normalizedSymbol} on ${date}`);
    
    return { success: true };
  } catch (error) {
    corpActionsLogger.error('Error adding action:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Corporate Actions Processing (Upstox primary + NSE fallback)
// ============================================================================

/**
 * Process corporate actions for portfolio symbols.
 * Uses Upstox Fundamentals API as primary source by ISIN, falling back to NSE API if needed.
 * 
 * @param fromDate - Optional start date (defaults to 30 days ago)
 * @param toDate - Optional end date (defaults to 30 days from now)
 * @returns Result with count of actions added
 */
export async function processCorporateActions(
  fromDate?: Date,
  toDate?: Date
): Promise<CorporateActionResult> {
  const details: string[] = [];
  
  // Default date range: last 30 days to next 30 days
  const startDate = fromDate || subDays(new Date(), 30);
  const endDate = toDate || addDays(new Date(), 30);
  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');

  try {
    // 1. Get all unique symbols from portfolio
    const portfolioSymbols = await prisma.transaction.findMany({
      where: {
        type: { in: ['BUY', 'SELL'] }
      },
      select: { symbol: true },
      distinct: ['symbol']
    });
    
    const symbols = Array.from(new Set(portfolioSymbols.map(s => s.symbol.toUpperCase()))).sort();
    
    if (symbols.length === 0) {
      return {
        success: true,
        message: 'No portfolio symbols to check',
        actionsAdded: 0
      };
    }
    
    corpActionsLogger.info(`Checking corporate actions for ${symbols.length} portfolio symbols from ${startDateStr} to ${endDateStr}`);
    details.push(`Portfolio symbols: ${symbols.length}`);
    details.push(`Date range: ${startDateStr} to ${endDateStr}`);
    
    let actionsAdded = 0;
    const handledSymbols = new Set<string>();

    // 2. Primary check: Upstox Fundamentals Corporate Actions API per symbol ISIN
    for (const symbol of symbols) {
      try {
        const instData = await getInstrumentData(symbol);
        if (!instData?.isin) {
          corpActionsLogger.debug(`No ISIN found for ${symbol}, will check fallback`);
          continue;
        }

        const events = await getCorporateActionsByISIN(instData.isin);
        if (!events || events.length === 0) continue;

        for (const event of events) {
          const { type, ratio, dateStr } = parseUpstoxCorporateAction(event);
          if (!type || ratio <= 1 || !dateStr) continue;

          // Check if action date falls within requested window
          if (dateStr < startDateStr || dateStr > endDateStr) continue;

          const result = await addCorporateAction(symbol, dateStr, type, ratio);
          handledSymbols.add(symbol);

          if (result.success) {
            actionsAdded++;
            details.push(`[Upstox] Added: ${symbol} ${type} ${ratio}:1 on ${dateStr}`);
            corpActionsLogger.info(`[Upstox] Added ${type} for ${symbol} on ${dateStr} (ratio: ${ratio}:1)`);
          } else if (result.error !== 'Corporate action already exists for this date') {
            details.push(`[Upstox] Failed: ${symbol} - ${result.error}`);
          }
        }
      } catch (err) {
        corpActionsLogger.warn(`Upstox corp action check failed for ${symbol}:`, err);
      }
    }

    // 3. Secondary fallback: Check NSE Corporate Actions for any symbols not resolved by Upstox
    const symbolsNeedingFallback = symbols.filter(s => !handledSymbols.has(s));
    if (symbolsNeedingFallback.length > 0) {
      try {
        const nseActions = await fetchNSECorporateActions(startDate, endDate);
        if (nseActions && nseActions.length > 0) {
          const fallbackSet = new Set(symbolsNeedingFallback);

          for (const action of nseActions) {
            const sym = action.symbol.toUpperCase();
            if (!fallbackSet.has(sym)) continue;

            const { type, ratio } = parseSplitBonusRatio(action.subject);
            if (!type || ratio <= 1) continue;

            const dateStr = parseNSEDateToStr(action.exDate);
            if (!dateStr || dateStr < startDateStr || dateStr > endDateStr) continue;

            const result = await addCorporateAction(sym, dateStr, type, ratio);
            if (result.success) {
              actionsAdded++;
              details.push(`[NSE] Added: ${sym} ${type} ${ratio}:1 on ${dateStr}`);
              corpActionsLogger.info(`[NSE] Added ${type} for ${sym}: ${action.subject}`);
            } else if (result.error !== 'Corporate action already exists for this date') {
              details.push(`[NSE] Failed: ${sym} - ${result.error}`);
            }
          }
        }
      } catch (nseErr) {
        corpActionsLogger.warn('NSE fallback corporate actions fetch failed:', nseErr);
      }
    }

    corpActionsLogger.info(`Corporate actions sync complete. Added ${actionsAdded} new actions.`);
    details.push(`Total new actions added: ${actionsAdded}`);

    // 4. Trigger portfolio recalculation if any actions were added
    if (actionsAdded > 0) {
      corpActionsLogger.info('Triggering portfolio recalculation...');
      await triggerRecalculatePortfolio();
      details.push('Portfolio recalculation triggered');
    }

    return {
      success: true,
      message: actionsAdded > 0 
        ? `Successfully added ${actionsAdded} corporate action(s)` 
        : 'No new corporate actions to add',
      actionsAdded,
      details
    };

  } catch (error) {
    corpActionsLogger.error('Error in processCorporateActions:', error);
    return {
      success: false,
      message: `Error processing corporate actions: ${(error as Error).message}`,
      actionsAdded: 0,
      details
    };
  }
}

// Backward compatibility alias for existing cron route / callers
export const processNSECorporateActions = processCorporateActions;
