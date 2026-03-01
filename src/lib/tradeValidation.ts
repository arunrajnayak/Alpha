// Client-side trade validation utilities
// Using a simple browser-compatible CSV parser

import { format } from 'date-fns';

// Types for trade validation - using string dates for serialization
export interface ParsedTrade {
  date: string; // ISO date string for serialization
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderId: string;
  tradeId?: string;
  isin?: string;
}

export interface Discrepancy {
  symbol: string;
  date: string; // ISO date string for serialization
  endingQty: number;
  message: string;
}

export interface TradeSummary {
  totalBuys: number;
  totalSells: number;
  totalExits: number;
  uniqueSymbols: string[];
  dateRange: { from: string; to: string } | null; // ISO date strings
  totalValue: number;
}

export interface TradeValidationResult {
  success: boolean;
  trades: ParsedTrade[];
  discrepancies: Discrepancy[];
  summary: TradeSummary;
  error?: string;
}

// Simple browser-compatible CSV parser
function parseCSV(csvContent: string): Record<string, string>[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Parse header line
  const headers = parseCSVLine(lines[0]);
  
  // Parse data lines
  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    const record: Record<string, string> = {};
    
    headers.forEach((header, idx) => {
      record[header.trim()] = values[idx]?.trim() || '';
    });
    
    records.push(record);
  }
  
  return records;
}

// Parse a single CSV line, handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current); // Don't forget the last field
  
  return result;
}

// Raw CSV row from Zerodha tradebook
interface ZerodhaCsvRow {
  symbol: string;
  isin?: string;
  trade_date: string;
  exchange?: string;
  segment?: string;
  series?: string;
  trade_type: string;
  auction?: string;
  quantity: string;
  price: string;
  trade_id?: string;
  order_id?: string;
  order_execution_time?: string;
}

/**
 * Parse a date string from Zerodha format to UTC Midnight
 * Supports: YYYY-MM-DD, DD-MM-YYYY
 */
function parseTradeDate(dateStr: string): Date | null {
   // Try ISO format first (YYYY-MM-DD)
   if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
       // Extract Y, M, D ignoring time components
       const [y, m, d] = dateStr.split(' ')[0].split('-').map(Number);
       return new Date(Date.UTC(y, m - 1, d));
   }
   
   // Try DD-MM-YYYY format
   const parts = dateStr.split('-');
   if (parts.length === 3 && parts[0].length === 2) {
     const day = parseInt(parts[0], 10);
     const month = parseInt(parts[1], 10) - 1;
     const year = parseInt(parts[2], 10);
     // Force UTC
     const date = new Date(Date.UTC(year, month, day));
     if (!isNaN(date.getTime())) {
       return date; 
     }
   }
   
   // Fallback: If standard parsing works, force it to UTC same date
   const d = new Date(dateStr);
   if (!isNaN(d.getTime())) {
       return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
   }

   return null;
}

/**
 * Parse and validate a Zerodha tradebook CSV
 * Returns parsed trades and any discrepancies found
 */
export function validateTradebook(csvContent: string): TradeValidationResult {
  try {
    const records = parseCSV(csvContent) as unknown as ZerodhaCsvRow[];

    if (records.length === 0) {
      return {
        success: false,
        trades: [],
        discrepancies: [],
        summary: { totalBuys: 0, totalSells: 0, totalExits: 0, uniqueSymbols: [], dateRange: null, totalValue: 0 },
        error: 'No trades found in the CSV file'
      };
    }

    const trades: ParsedTrade[] = [];
    const parseErrors: string[] = [];

    // Parse each record
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      // Skip if vital fields are missing
      if (!record.symbol || !record.trade_date) {
        parseErrors.push(`Row ${i + 2}: Missing symbol or trade_date`);
        continue;
      }

      const date = parseTradeDate(record.trade_date);
      if (!date) {
        parseErrors.push(`Row ${i + 2}: Invalid date format "${record.trade_date}"`);
        continue;
      }

      const quantity = parseFloat(record.quantity);
      const price = parseFloat(record.price);

      if (isNaN(quantity) || quantity <= 0) {
        parseErrors.push(`Row ${i + 2}: Invalid quantity "${record.quantity}"`);
        continue;
      }

      if (isNaN(price) || price < 0) {
        parseErrors.push(`Row ${i + 2}: Invalid price "${record.price}"`);
        continue;
      }

      const type = record.trade_type.toLowerCase().trim() === 'buy' ? 'BUY' : 'SELL';
      const orderId = record.trade_id || record.order_id || 
        `${record.symbol}-${date.toISOString()}-${record.quantity}-${record.price}`;

      trades.push({
        date: date.toISOString(),
        symbol: record.symbol.toUpperCase(),
        type,
        quantity,
        price,
        orderId,
        tradeId: record.trade_id,
        isin: record.isin
      });
    }

    if (trades.length === 0) {
      return {
        success: false,
        trades: [],
        discrepancies: [],
        summary: { totalBuys: 0, totalSells: 0, totalExits: 0, uniqueSymbols: [], dateRange: null, totalValue: 0 },
        error: parseErrors.length > 0 ? parseErrors.join('\n') : 'No valid trades found in the CSV file'
      };
    }

    // Sort trades by date
    trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Detect discrepancies (negative quantities at end of any day)
    const discrepancies = detectDiscrepancies(trades);

    // Generate summary
    const summary = generateSummary(trades);

    return {
      success: true,
      trades,
      discrepancies,
      summary
    };
  } catch (error) {
    return {
      success: false,
      trades: [],
      discrepancies: [],
      summary: { totalBuys: 0, totalSells: 0, totalExits: 0, uniqueSymbols: [], dateRange: null, totalValue: 0 },
      error: error instanceof Error ? error.message : 'Failed to parse CSV file'
    };
  }
}

/**
 * Detect discrepancies in trade data
 * Checks if any symbol has negative quantity at end of any day
 * @param trades - The trades being imported
 * @param existingHoldings - Optional map of symbol to current quantity (existing holdings)
 */
export function detectDiscrepancies(
  trades: ParsedTrade[], 
  existingHoldings?: Record<string, number>
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  
  // Start with existing holdings if provided, otherwise start from 0
  const runningQty = new Map<string, number>();
  if (existingHoldings) {
    for (const [symbol, qty] of Object.entries(existingHoldings)) {
      runningQty.set(symbol, qty);
    }
  }
  
  // Get unique dates sorted
  const uniqueDates = [...new Set(trades.map(t => format(new Date(t.date), 'yyyy-MM-dd')))].sort();
  
  for (const dateStr of uniqueDates) {
    const dayTrades = trades.filter(t => format(new Date(t.date), 'yyyy-MM-dd') === dateStr);
    
    // Process all trades for this day
    for (const trade of dayTrades) {
      const currentQty = runningQty.get(trade.symbol) || 0;
      const newQty = trade.type === 'BUY' 
        ? currentQty + trade.quantity 
        : currentQty - trade.quantity;
      runningQty.set(trade.symbol, newQty);
    }
    
    // Check for negative quantities at end of this day
    for (const [symbol, qty] of runningQty) {
      if (qty < -0.001) {
        // Check if we already have a discrepancy for this symbol on this date
        const existing = discrepancies.find(
          d => d.symbol === symbol && d.date === dateStr
        );
        if (!existing) {
          discrepancies.push({
            symbol,
            date: dateStr,
            endingQty: qty,
            message: `${symbol} has negative quantity (${qty.toFixed(2)}) at end of ${dateStr}. This may indicate a missing BUY trade.`
          });
        }
      }
    }
  }
  
  return discrepancies;
}

/**
 * Generate summary statistics for trades
 */
export function generateSummary(trades: ParsedTrade[]): TradeSummary {
  // Logic for group-based counting (unique orders)
  const buyGroups = new Set<string>();
  const sellGroups = new Set<string>();
  const symbolsSet = new Set<string>();
  
  trades.forEach(t => {
      symbolsSet.add(t.symbol);
      
      const dateStr = format(new Date(t.date), 'yyyy-MM-dd');
      const key = `${dateStr}-${t.symbol}-${t.type}`;
      
      if (t.type === 'BUY') {
          buyGroups.add(key);
      } else {
          sellGroups.add(key);
      }
  });

  const dates = trades.map(t => new Date(t.date));
  const dateRange = dates.length > 0 
    ? { 
        from: new Date(Math.min(...dates.map(d => d.getTime()))).toISOString(), 
        to: new Date(Math.max(...dates.map(d => d.getTime()))).toISOString() 
      }
    : null;
  
  const totalValue = trades.reduce((sum, t) => sum + (t.quantity * t.price), 0);
  
  // Calculate Exits
  let totalExits = 0;
  
  const uniqueSymbols = Array.from(symbolsSet).sort();
  
  for (const symbol of uniqueSymbols) {
    // Get trades for this symbol, sorted by date
    const symbolTrades = trades
      .filter(t => t.symbol === symbol)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Group by Date for end-of-day check
    const dateGroups = new Map<string, ParsedTrade[]>();
    symbolTrades.forEach(t => {
        const d = format(new Date(t.date), 'yyyy-MM-dd');
        if (!dateGroups.has(d)) dateGroups.set(d, []);
        dateGroups.get(d)!.push(t);
    });

    const uniqueDates = Array.from(dateGroups.keys()).sort();
    
    let currentQty = 0;
    let wasActive = false;

    for (const dateStr of uniqueDates) {
        const daysTrades = dateGroups.get(dateStr) || [];
        
        for (const t of daysTrades) {
            if (t.type === 'BUY') currentQty += t.quantity;
            else currentQty -= t.quantity;
        }

        // Check for floating point zero equality
        const isZero = Math.abs(currentQty) < 0.001;

        if (!isZero) {
            wasActive = true;
        } else if (isZero && wasActive) {
            totalExits++;
            wasActive = false; 
        }
    }
  }

  return {
    totalBuys: buyGroups.size,
    totalSells: sellGroups.size,
    totalExits,
    uniqueSymbols,
    dateRange,
    totalValue
  };
}
