'use server';

import { prisma } from '@/lib/db';
import { fetchNSECorporateActions, NSECorporateAction } from '@/lib/nse-api';
import { subDays, addDays, parse, format } from 'date-fns';
import { triggerRecalculatePortfolio } from '@/app/actions';

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

/**
 * Parse NSE corporate action subject to extract type and ratio
 * 
 * Examples:
 * - "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share" → SPLIT, ratio 5
 * - "Bonus issue 1:1" → BONUS, ratio 2
 * - "Dividend - Rs 5 Per Share" → null (not a split/bonus)
 */
function parseSplitBonusRatio(subject: string): { type: 'SPLIT' | 'BONUS' | null; ratio: number } {
  const subjectLower = subject.toLowerCase();
  
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

/**
 * Parse NSE date format "28-Jan-2025" to Date object
 */
function parseNSEDate(dateStr: string): Date | null {
  try {
    // Handle "-" as empty date
    if (dateStr === '-' || !dateStr) return null;
    
    // Parse "28-Jan-2025" format
    const parsed = parse(dateStr, 'dd-MMM-yyyy', new Date());
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
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
    const actionDate = new Date(date);
    actionDate.setUTCHours(0, 0, 0, 0);
    const normalizedSymbol = symbol.toUpperCase();
    
    // Check for existing action
    const existing = await prisma.transaction.findFirst({
      where: {
        symbol: normalizedSymbol,
        date: actionDate,
        type
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
    
    console.log(`[Corporate Action] Added ${type} ${ratio}:1 for ${normalizedSymbol} on ${date}`);
    
    return { success: true };
  } catch (error) {
    console.error('[Corporate Action] Error adding action:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// NSE Corporate Actions Processing
// ============================================================================

/**
 * Process corporate actions from NSE API
 * Fetches corporate actions for portfolio symbols and records new splits/bonuses
 * 
 * @param fromDate - Optional start date (defaults to 30 days ago)
 * @param toDate - Optional end date (defaults to 30 days from now)
 * @returns Result with count of actions added
 */
export async function processNSECorporateActions(
  fromDate?: Date,
  toDate?: Date
): Promise<CorporateActionResult> {
  const details: string[] = [];
  
  // Default date range: last 30 days to next 30 days
  const startDate = fromDate || subDays(new Date(), 30);
  const endDate = toDate || addDays(new Date(), 30);
  
  try {
    // 1. Get all unique symbols from portfolio
    const portfolioSymbols = await prisma.transaction.findMany({
      where: {
        type: { in: ['BUY', 'SELL'] }
      },
      select: { symbol: true },
      distinct: ['symbol']
    });
    
    const symbols = new Set(portfolioSymbols.map(s => s.symbol.toUpperCase()));
    
    if (symbols.size === 0) {
      return {
        success: true,
        message: 'No portfolio symbols to check',
        actionsAdded: 0
      };
    }
    
    console.log(`[Corporate Action Sync] Checking ${symbols.size} portfolio symbols`);
    details.push(`Portfolio symbols: ${symbols.size}`);
    details.push(`Date range: ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
    
    const nseActions = await fetchNSECorporateActions(startDate, endDate);
    
    if (!nseActions) {
      return {
        success: false,
        message: 'Failed to fetch corporate actions from NSE',
        actionsAdded: 0
      };
    }
    
    console.log(`[Corporate Action Sync] Fetched ${nseActions.length} actions from NSE`);
    details.push(`NSE actions fetched: ${nseActions.length}`);
    
    // 3. Filter and process relevant actions
    let actionsAdded = 0;
    const relevantActions: NSECorporateAction[] = [];
    
    for (const action of nseActions) {
      // Only process EQ series and portfolio symbols
      if (action.series !== 'EQ') continue;
      if (!symbols.has(action.symbol.toUpperCase())) continue;
      
      const { type, ratio } = parseSplitBonusRatio(action.subject);
      
      // Skip non-split/bonus actions or invalid ratios
      if (!type || ratio <= 1) continue;
      
      const exDate = parseNSEDate(action.exDate);
      if (!exDate) continue;
      
      relevantActions.push(action);
      
      const dateStr = format(exDate, 'yyyy-MM-dd');
      const result = await addCorporateAction(action.symbol, dateStr, type, ratio);
      
      if (result.success) {
        actionsAdded++;
        details.push(`Added: ${action.symbol} ${type} ${ratio}:1 on ${dateStr}`);
        console.log(`[Corporate Action Sync] Added ${type} for ${action.symbol}: ${action.subject}`);
      } else if (result.error !== 'Corporate action already exists for this date') {
        details.push(`Failed: ${action.symbol} - ${result.error}`);
      }
    }
    
    console.log(`[Corporate Action Sync] Found ${relevantActions.length} relevant actions, added ${actionsAdded} new`);
    details.push(`Relevant actions: ${relevantActions.length}, New: ${actionsAdded}`);
    
    // 4. Trigger portfolio recalculation if any actions were added
    if (actionsAdded > 0) {
      console.log('[Corporate Action Sync] Triggering portfolio recalculation...');
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
    console.error('[Corporate Action Sync] Error:', error);
    return {
      success: false,
      message: `Error processing corporate actions: ${(error as Error).message}`,
      actionsAdded: 0,
      details
    };
  }
}
