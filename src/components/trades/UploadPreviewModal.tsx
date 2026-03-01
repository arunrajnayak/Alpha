'use client';

import * as React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';


import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import type { ParsedTrade, Discrepancy, TradeSummary } from '@/lib/tradeValidation';
import { detectDiscrepancies, generateSummary } from '@/lib/tradeValidation';
import { type SymbolValidationResult, validateSymbols } from '@/app/actions';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faClipboardList, 
  faCalendarDays,
  faChartBar, 
  faFlagCheckered, 
  faArrowTrendUp, 
  faArrowTrendDown,
  faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';

interface UploadPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filteredTrades: ParsedTrade[], symbolMappings?: Record<string, string>) => void;
  trades: ParsedTrade[];
  discrepancies: Discrepancy[];
  summary: TradeSummary;
  isLoading?: boolean;
  validationResults?: SymbolValidationResult[];
  existingHoldings?: Record<string, number>;
}

// Grouped Trade Interface
interface GroupedTrade {
    id: string; // Composite ID
    date: Date; // Keep as Date object for sorting
    symbol: string;
    type: string;
    quantity: number;
    avgPrice: number;
    totalAmount: number;
    trades: { originalIndex: number; data: ParsedTrade }[];
}

export default function UploadPreviewModal({
  isOpen,
  onClose,
  onConfirm,
  trades: initialTrades,
  // discrepancies: initialDiscrepancies, // Unused
  // summary: initialSummary, // Unused
  isLoading = false,
  validationResults = [],
  existingHoldings = {}
}: UploadPreviewModalProps) {
  
  /* State for Symbol Renaming */
  const [symbolMappings, setSymbolMappings] = useState<Record<string, string>>({});
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [symbolToRename, setSymbolToRename] = useState<{ old: string, new: string } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Helper to get effective symbol
  const getEffectiveSymbol = React.useCallback((symbol: string) => {
    return symbolMappings[symbol] || symbol;
  }, [symbolMappings]);

  // Grouping Logic
  const groupedTrades = useMemo(() => {
    const groups = new Map<string, GroupedTrade>();

    initialTrades.forEach((trade, index) => {
        // Apply symbol rename
        const effectiveSymbol = getEffectiveSymbol(trade.symbol);
        
        // Key: Date string + Symbol + Type
        try {
            const dateStr = format(new Date(trade.date), 'yyyy-MM-dd');
            const key = `${dateStr}-${effectiveSymbol}-${trade.type}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    id: key,
                    date: new Date(trade.date),
                    symbol: effectiveSymbol,
                    type: trade.type,
                    quantity: 0,
                    avgPrice: 0,
                    totalAmount: 0,
                    trades: []
                });
            }

            const group = groups.get(key)!;
            // Store modified trade data if needed, but here we just group
            // We pass originalIndex so we can toggle exclusion on the original array
            group.trades.push({ originalIndex: index, data: { ...trade, symbol: effectiveSymbol } });
            group.quantity += trade.quantity;
            group.totalAmount += (trade.quantity * trade.price);
        } catch (e) {
            console.error("Error grouping trade:", trade, e);
        }
    });

    const result: GroupedTrade[] = [];
    for (const g of groups.values()) {
        g.avgPrice = g.quantity > 0 ? g.totalAmount / g.quantity : 0;
        result.push(g);
    }

    // Sort by date ascending (oldest first)
    return result.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [initialTrades, getEffectiveSymbol]);

  // Computed: Active Trades (not excluded) with renames applied
  const activeTrades = useMemo(() => {
    return initialTrades
        .filter((_, idx) => !excludedIndices.has(idx))
        .map(t => ({ ...t, symbol: getEffectiveSymbol(t.symbol) }));
  }, [initialTrades, excludedIndices, getEffectiveSymbol]);

  // Computed: Re-run validation specific to active trades
  const { summary, discrepancies } = useMemo(() => {
    if (activeTrades.length === 0) {
       return {
         summary: { totalBuys: 0, totalSells: 0, totalExits: 0, uniqueSymbols: [], dateRange: null, totalValue: 0 },
         discrepancies: []
       };
    }
    return {
      summary: generateSummary(activeTrades),
      discrepancies: detectDiscrepancies(activeTrades, existingHoldings)
    };
  }, [activeTrades, existingHoldings]);

  const hasDiscrepancies = discrepancies.length > 0;
  const excludedCount = excludedIndices.size;

  // Filter invalid symbols, but remove those that have been renamed
  const invalidSymbols = useMemo(() => {
     return validationResults.filter(r => !r.isValid && !symbolMappings[r.symbol]);
  }, [validationResults, symbolMappings]);

  // Toggle single trade
  const toggleTrade = (idx: number) => {
    const next = new Set(excludedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setExcludedIndices(next);
  };

  // Toggle entire group
  const toggleGroup = (group: GroupedTrade) => {
      const allIndices = group.trades.map(t => t.originalIndex);
      const allExcluded = allIndices.every(idx => excludedIndices.has(idx));
      
      const next = new Set(excludedIndices);
      if (allExcluded) {
          // Include all
          allIndices.forEach(idx => next.delete(idx));
      } else {
          // Exclude all
          allIndices.forEach(idx => next.add(idx));
      }
      setExcludedIndices(next);
  };

  const toggleExpandGroup = (groupId: string) => {
      const next = new Set(expandedGroups);
      if (next.has(groupId)) {
          next.delete(groupId);
      } else {
          next.add(groupId);
      }
      setExpandedGroups(next);
  };

  const handleConfirm = () => {
    // Pass symbol mappings so they can be recorded as corporate actions
    const mappingsToRecord = Object.keys(symbolMappings).length > 0 ? symbolMappings : undefined;
    onConfirm(activeTrades, mappingsToRecord);
  };

  const handleOpenRename = (oldSymbol: string) => {
      setSymbolToRename({ old: oldSymbol, new: oldSymbol });
      setValidationError(null);
      setRenameDialogOpen(true);
  };

  const handleSaveRename = async () => {
      if (!symbolToRename?.new) {
          return;
      }

      setIsValidating(true);
      setValidationError(null);

      try {
          const results = await validateSymbols([symbolToRename.new]);
          if (results[0]?.isValid) {
              setSymbolMappings(prev => ({
                  ...prev,
                  [symbolToRename.old]: symbolToRename.new.toUpperCase()
              }));
              setRenameDialogOpen(false);
              setSymbolToRename(null);
          } else {
              setValidationError(`Symbol "${symbolToRename.new}" not found on Yahoo Finance (NSE).`);
          }
      } catch (error) {
          console.error("Validation error:", error);
          setValidationError("Failed to validate symbol. Please try again.");
      } finally {
          setIsValidating(false);
      }
  };

  const formatDate = (dateInput: string | Date) => {
    try {
      return format(new Date(dateInput), 'dd MMM yyyy');
    } catch {
      return String(dateInput);
    }
  };

  return (
    <>
    <Dialog 
      open={isOpen} 
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        className: "glass-card",
        sx: { 
          backgroundImage: 'none',
          backgroundColor: 'rgba(31, 41, 55, 0.95)', 
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '1rem',
          minHeight: '80vh',
          maxHeight: '90vh'
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.1)', px: 3, py: 2 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faClipboardList} className="text-blue-400 text-2xl" />
            <span className="gradient-text font-bold text-2xl">
              Review Tradebook
            </span>
          </div>
          {excludedCount > 0 && (
            <div className="px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full text-xs text-yellow-400 font-medium">
              {excludedCount} trades excluded
            </div>
          )}
        </div>
        <p className="text-sm text-gray-400 mt-1 font-normal">
          Verify trades match your records. Uncheck rows to exclude from import.
        </p>
      </DialogTitle>
      
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        <div className="flex-1 overflow-y-auto scroll-smooth p-6 space-y-6">
            
            {/* === STATS & DATE ROW === */}
            <div className="flex flex-col xl:flex-row gap-3">
                {/* Date Range Card */}
                {summary.dateRange && (
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-center min-w-[300px]">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <FontAwesomeIcon icon={faCalendarDays} className="text-blue-400" />
                            </div>
                            <div>
                                <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">Trading Period</p>
                                <div className="flex items-center gap-2">
                                    <span className="text-white font-mono font-medium text-sm">{formatDate(summary.dateRange.from)}</span>
                                    <span className="text-gray-500 text-xs">→</span>
                                    <span className="text-white font-mono font-medium text-sm">{formatDate(summary.dateRange.to)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
                    <StatCard 
                        label="Total Count" 
                        value={activeTrades.length.toLocaleString()} 
                        icon={faChartBar}
                    />
                    <StatCard 
                        label="Exits" 
                        value={summary.totalExits.toLocaleString()} 
                        icon={faFlagCheckered}
                        color="blue"
                    />
                    <StatCard 
                        label="Buy Orders" 
                        value={summary.totalBuys.toLocaleString()} 
                        icon={faArrowTrendUp}
                        color="emerald"
                    />
                    <StatCard 
                        label="Sell Orders" 
                        value={summary.totalSells.toLocaleString()} 
                        icon={faArrowTrendDown}
                        color="red"
                    />
                </div>
            </div>

            {/* === SYMBOL VALIDATION ISSUES === */}
            {invalidSymbols.length > 0 && (
                 <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-start gap-3">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="text-orange-400 text-xl mt-0.5" />
                        <div>
                            <h4 className="text-orange-400 font-bold mb-1">Unknown Symbols Detected</h4>
                            <p className="text-sm text-gray-300">
                                The following symbols could not be validated against Exchange Data. 
                                They might be <strong>delisted, renamed, or have a different ticker</strong>.
                            </p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {invalidSymbols.map((r, idx) => (
                            <div key={idx} className="px-4 py-3 rounded-md bg-white/5 border border-white/10 flex items-center justify-between">
                                <span className="font-bold text-white">{r.symbol}</span>
                                <Button 
                                    size="small" 
                                    variant="outlined" 
                                    color="warning"
                                    onClick={() => handleOpenRename(r.symbol)}
                                    sx={{ 
                                        textTransform: 'none', 
                                        fontSize: '0.75rem', 
                                        py: 0.5,
                                        borderColor: 'rgba(251, 146, 60, 0.5)',
                                        color: '#fb923c',
                                        '&:hover': {
                                            borderColor: '#fb923c',
                                            backgroundColor: 'rgba(251, 146, 60, 0.1)'
                                        }
                                    }}
                                >
                                    Rename Symbol
                                </Button>
                            </div>
                        ))}
                    </div>
                 </div>
            )}

            {/* === DISCREPANCIES === */}
            {hasDiscrepancies && (
                 <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="text-red-400 text-xl mt-0.5" />
                        <div>
                            <h4 className="text-red-400 font-bold mb-1">Potential Issues Found</h4>
                            <p className="text-sm text-gray-300">
                                The following symbols have <strong>sell trades exceeding buy trades</strong>.
                                Check the box to exclude specific trades if needed.
                            </p>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        {discrepancies.map((d, idx) => (
                            <div key={idx} className="px-4 py-3 rounded-md bg-white/5 border border-white/10 flex items-center justify-between">
                                <span className="font-bold text-white">{d.symbol}</span>
                                <div className="text-right">
                                    <span className="text-xs text-gray-400 block">Ending Balance</span>
                                    <span className="text-red-400 font-mono font-bold">{d.endingQty.toFixed(2)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                 </div>
            )}

            {/* === TRADES TABLE === */}
            <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a0f1a]/50">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-white/5">
                    <tr>
                        <th className="p-3 w-10"></th>
                        <th className="p-3 w-10 text-center">
                            <span className="sr-only">Select</span>
                        </th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Symbol</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Qty</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Avg Price</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
                        <th className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Count</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                    {groupedTrades.map((group) => {
                        const allIndices = group.trades.map(t => t.originalIndex);
                        const isFullyExcluded = allIndices.every(idx => excludedIndices.has(idx));
                        const isPartiallyExcluded = !isFullyExcluded && allIndices.some(idx => excludedIndices.has(idx));
                        const isExpanded = expandedGroups.has(group.id);
                        const hasMultiple = group.trades.length > 1;

                        const rowOpacity = isFullyExcluded ? 'opacity-50 grayscale' : 'opacity-100';

                        return (
                        <React.Fragment key={group.id}>
                            <tr 
                                className={`transition-colors hover:bg-white/[0.02] cursor-pointer ${rowOpacity}`}
                                onClick={() => hasMultiple && toggleExpandGroup(group.id)}
                            >
                                <td className="p-2 text-center">
                                    {hasMultiple && (
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleExpandGroup(group.id); }}>
                                            {isExpanded ? <KeyboardArrowUpIcon sx={{ color: 'gray', fontSize: 16 }} /> : <KeyboardArrowDownIcon sx={{ color: 'gray', fontSize: 16 }} />}
                                        </IconButton>
                                    )}
                                </td>
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                    <Checkbox 
                                        checked={!isFullyExcluded}
                                        indeterminate={isPartiallyExcluded}
                                        onChange={() => toggleGroup(group)}
                                        size="small"
                                        sx={{
                                            color: '#6b7280',
                                            '&.Mui-checked': { color: group.type === 'BUY' ? '#10b981' : '#ef4444' },
                                            '&.MuiCheckbox-indeterminate': { color: '#fbbf24' },
                                            p: 0.5
                                        }}
                                    />
                                </td>
                                <td className="p-3 text-sm text-gray-300 font-mono">{formatDate(group.date)}</td>
                                <td className="p-3 text-sm font-medium text-white">
                                    {group.symbol}
                                    {symbolMappings[initialTrades[group.trades[0].originalIndex].symbol] && (
                                        <span className="ml-2 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                                           RENAMED
                                        </span>
                                    )}
                                    {validationResults.find(r => r.symbol === group.symbol && r.originalSymbol && r.originalSymbol !== group.symbol) && (
                                         <span className="ml-2 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                            AUTO-RESOLVED
                                         </span>
                                    )}
                                </td>
                                <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                                        group.type === 'BUY' 
                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                                    }`}>
                                        {group.type}
                                    </span>
                                </td>
                                <td className="p-3 text-sm text-gray-300 text-right font-mono">{group.quantity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                                <td className="p-3 text-sm text-gray-300 text-right font-mono">₹{group.avgPrice.toFixed(2)}</td>
                                <td className="p-3 text-sm text-gray-400 text-right font-mono">₹{group.totalAmount.toFixed(0)}</td>
                                <td className="p-3 text-xs text-gray-500 text-center">{group.trades.length}</td>
                            </tr>
                            
                            {/* Expanded Row */}
                            <tr className={isExpanded ? '' : 'hidden'}>
                                <td colSpan={9} className="p-0 bg-black/20">
                                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                        <div className="pl-12 pr-4 py-2 border-b border-white/5">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="text-gray-500 border-b border-white/5">
                                                        <th className="p-2 w-8"></th>
                                                        <th className="p-2 text-left">Internal ID</th>
                                                        <th className="p-2 text-right">Qty</th>
                                                        <th className="p-2 text-right">Price</th>
                                                        <th className="p-2 text-right">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {group.trades.map((t, i) => (
                                                        <tr key={i} className="text-gray-400 hover:text-gray-200">
                                                            <td className="p-2">
                                                                <Checkbox 
                                                                    checked={!excludedIndices.has(t.originalIndex)}
                                                                    onChange={() => toggleTrade(t.originalIndex)}
                                                                    size="small"
                                                                    sx={{ color: '#4b5563', '&.Mui-checked': { color: '#6b7280' }, p: 0 }}
                                                                />
                                                            </td>
                                                            <td className="p-2">Transaction #{i+1}</td>
                                                            <td className="p-2 text-right font-mono">{t.data.quantity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                                                            <td className="p-2 text-right font-mono">₹{t.data.price.toFixed(2)}</td>
                                                            <td className="p-2 text-right font-mono">₹{(t.data.quantity * t.data.price).toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </Collapse>
                                </td>
                            </tr>
                        </React.Fragment>
                        );
                    })}
                    </tbody>
                </table>
            </div>

        </div>
      </DialogContent>
      
      <DialogActions sx={{ borderTop: '1px solid rgba(255,255,255,0.1)', px: 3, py: 2, justifyContent: 'space-between', bgcolor: 'rgba(10, 15, 26, 0.5)' }}>
          <div className="text-xs text-gray-500 hidden lg:block">
            {activeTrades.length} records ready to process {excludedCount > 0 && <span className="text-yellow-500">({excludedCount} excluded)</span>}
          </div>
          <div className="flex gap-3">
            <Button 
              variant="text" 
              onClick={onClose}
              disabled={isLoading}
              sx={{ color: '#9ca3af', '&:hover': { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' } }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirm}
              loading={isLoading}
              variant="contained"
              className={`font-semibold shadow-lg px-6 ${
                hasDiscrepancies 
                  ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:shadow-orange-500/25 shadow-orange-900/20'
                  : 'btn-gradient hover:shadow-blue-500/25'
              }`}
              sx={{
                background: hasDiscrepancies ? 'linear-gradient(to right, #ea580c, #dc2626)' : undefined,
                ...( !hasDiscrepancies && { background: 'linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 100%)' } ),
              }}
            >
              {hasDiscrepancies ? 'Confirm Import (With Warnings)' : `Confirm Import (${activeTrades.length})`}
            </Button>
          </div>
      </DialogActions>
    </Dialog>
    
    {/* Rename Dialog */}
    <Dialog 
        open={renameDialogOpen} 
        onClose={() => !isValidating && setRenameDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          className: "glass-card",
          sx: { 
            backgroundImage: 'none',
            backgroundColor: 'rgba(31, 41, 55, 0.95)', 
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1rem',
          }
        }}
    >
        <DialogTitle sx={{ color: 'white' }}>Rename Symbol</DialogTitle>
        <DialogContent>
            <div className="pt-2 text-white">
                <p className="text-sm text-gray-400 mb-3">
                    Rename <strong>{symbolToRename?.old}</strong> to a valid NSE ticker symbol. 
                    This will update all trades for this symbol.
                </p>
                <div className="flex flex-col gap-2">
                    <label className="text-xs text-gray-500 uppercase font-bold">New Ticker Symbol</label>
                    <input 
                        type="text" 
                        value={symbolToRename?.new || ''}
                        onChange={(e) => {
                            setSymbolToRename(prev => prev ? ({ ...prev, new: e.target.value.toUpperCase() }) : null);
                            setValidationError(null);
                        }}
                        disabled={isValidating}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                        placeholder="e.g. ZOMATO"
                        autoFocus
                    />
                    {validationError && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="text-sm" /> {validationError}
                        </p>
                    )}
                </div>
            </div>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
            <Button onClick={() => setRenameDialogOpen(false)} sx={{ color: 'gray' }} disabled={isValidating}>Cancel</Button>
            <Button 
                variant="contained" 
                onClick={handleSaveRename} 
                loading={isValidating}
                disabled={!symbolToRename?.new}
            >
                Update Symbol
            </Button>
        </DialogActions>
    </Dialog>
    </>
  );
}

function StatCard({ 
  label, 
  value, 
  icon,
  color,
}: { 
  label: string; 
  value: string; 
  icon: typeof faChartBar;
  color?: 'emerald' | 'red' | 'blue';
}) {
  const colorClasses = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    default: 'text-white'
  };
  
  const iconColorClasses = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    default: 'text-gray-400'
  };
  
  return (
    <div className="p-3 rounded-xl border bg-white/5 border-white/10 flex flex-col justify-between h-full">
      <div className="flex justify-between items-start mb-1">
        <FontAwesomeIcon icon={icon} className={`text-lg ${iconColorClasses[color || 'default']}`} />
        <span className={`text-xl font-bold tracking-tight ${colorClasses[color || 'default']}`}>{value}</span>
      </div>
      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{label}</p>
    </div>
  );
}
