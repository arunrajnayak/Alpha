'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSpring, useMotionValue } from 'framer-motion';
import Dialog from '@mui/material/Dialog';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import React, { forwardRef } from 'react';
import IconButton from '@mui/material/IconButton';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faScaleBalanced, 
  faLock, 
  faLockOpen, 
  faTrash, 
  faRotateLeft,
  faPlus,
  faMinus,
  faXmark,
  faCopy,
  faFloppyDisk
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import { searchStocks, getStockPrice, StockSearchResult } from '@/app/actions/stocks';
import {
  RebalanceState,
  RebalanceInputHolding,
  initializeRebalanceState,
  recalculateOnWeightChange,
  recalculateOnQtyChange,
  recalculateOnCashflowChange,
  applyEquiweight,
  addStock,
  removeStock,
  toggleLock,
  resetToOriginal,
  calculateSummary,
  setDiffThreshold,
} from '@/lib/rebalance';

interface RebalanceModalProps {
  open: boolean;
  onClose: () => void;
  currentHoldings: RebalanceInputHolding[];
  totalEquity: number;
  onResetToLive?: () => { holdings: RebalanceInputHolding[]; totalEquity: number } | null;
}

const REBALANCE_STORAGE_KEY = 'rebalance-draft-v1';

const buildHoldingsSignature = (holdings: RebalanceInputHolding[]) =>
  holdings.map(h => h.symbol).sort().join('|');

// Styled Components
const StyledHeaderCell = styled(TableCell)(() => ({
  backgroundColor: '#0f172a',
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  padding: '8px 12px',
}));

const StyledCell = styled(TableCell)(() => ({
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color: '#d1d5db',
  padding: '8px 12px',
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
}));

// Helper logic for hiding spinners
const hideSpinners = {
  '& input[type=number]': {
      MozAppearance: 'textfield',
  },
  '& input[type=number]::-webkit-outer-spin-button': {
      WebkitAppearance: 'none',
      margin: 0,
  },
  '& input[type=number]::-webkit-inner-spin-button': {
      WebkitAppearance: 'none',
      margin: 0,
  },
};

// Component for buffered input
interface BufferedNumberInputProps {
  value: number;
  onChange: (val: string) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
  width?: number | string;
  height?: number | string;
  endAdornment?: React.ReactNode;
  startAdornment?: React.ReactNode;
  decimalPlaces?: number;
}

const BufferedNumberInput = ({ 
  value, 
  onChange, 
  disabled, 
  step = 0.01, 
  min = 0, 
  max = 100,
  width = 90,
  height,
  endAdornment = <span className="text-gray-500 text-xs">%</span>,
  startAdornment,
  decimalPlaces = 2,
  fontSize = '0.9rem'
}: BufferedNumberInputProps & { fontSize?: number | string }) => {
    const formatValue = useCallback((v: number) => parseFloat(v.toFixed(decimalPlaces)).toString(), [decimalPlaces]);
    const [localValue, setLocalValue] = useState(formatValue(value));
    
    useEffect(() => {
        setLocalValue(formatValue(value));
    }, [value, formatValue]);

    const handleBlur = () => {
        onChange(localValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.currentTarget as HTMLInputElement).blur();
        }
    };

    return (
        <TextField
            type="number"
            size="small"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            sx={{ 
            width: width,
            ...hideSpinners,
            '& .MuiInputBase-root': {
                height: height, // Apply height to root to ensure input fills it
                pl: startAdornment ? 0 : 1 // Remove left padding if startAdornment exists
            },
            '& .MuiInputBase-input': { 
                textAlign: 'center', 
                color: disabled ? '#6b7280' : '#fff',
                py: 0.8,
                height: height ? 'auto' : undefined, // Let flex handle it if height is set on root
                fontWeight: 600,
                fontSize: fontSize
            },
            '& .MuiOutlinedInput-notchedOutline': { 
                borderColor: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.15)' 
            },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255,255,255,0.3)'
            }
            }}
            InputProps={{
            startAdornment: startAdornment ? <InputAdornment position="start" sx={{ mr: 0 }}>{startAdornment}</InputAdornment> : undefined,
            endAdornment: endAdornment ? <InputAdornment position="end">{endAdornment}</InputAdornment> : undefined,
            }}
            inputProps={{ min, max, step }}
        />
    );
};

const AnimatedNumber = ({ 
  value, 
  format = (v) => v.toFixed(2),
  className 
}: { 
  value: number; 
  format?: (v: number) => string;
  className?: string;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const springValue = useSpring(motionValue, { damping: 30, stiffness: 200 });

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = format(latest);
      }
    });
    return () => unsubscribe();
  }, [springValue, format]);

  return <span ref={ref} className={className}>{format(value)}</span>;
};

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});


export default function RebalanceModal({
  open,
  onClose,
  currentHoldings,
  totalEquity,
  onResetToLive,
}: RebalanceModalProps) {
  // State
  const [state, setState] = useState<RebalanceState>(() =>
    initializeRebalanceState(currentHoldings, totalEquity)
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isWithdrawal, setIsWithdrawal] = useState(false);
  const [localCashflow, setLocalCashflow] = useState('');
  const [sortBy, setSortBy] = useState<'symbol' | 'weight' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const savedStateLoaded = useRef(false);
  const holdingsSignature = useMemo(() => buildHoldingsSignature(currentHoldings), [currentHoldings]);

  // Memoized summary
  const summary = useMemo(() => calculateSummary(state), [state]);

  // Sorted holdings
  const sortedHoldings = useMemo(() => {
    if (!sortBy) return state.holdings;
    return [...state.holdings].sort((a, b) => {
      if (sortBy === 'symbol') {
        return sortDir === 'asc' ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      } else {
        return sortDir === 'asc' ? a.currentWeight - b.currentWeight : b.currentWeight - a.currentWeight;
      }
    });
  }, [state.holdings, sortBy, sortDir]);

  const toggleSort = (col: 'symbol' | 'weight') => {
    if (sortBy === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  // Debounced stock search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      return;
    }

    const timeout = setTimeout(async () => {
      setSearchLoading(true);
      const existingSymbols = state.holdings.map(h => h.symbol);
      const results = await searchStocks(searchQuery, existingSymbols);
      setSearchResults(results);
      setSearchLoading(false);
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, state.holdings]);

  // Load saved state once per session (if signature matches)
  useEffect(() => {
    if (savedStateLoaded.current) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(REBALANCE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { signature?: string; state?: RebalanceState };
      if (parsed?.signature === holdingsSignature && parsed?.state) {
        setState(parsed.state);
        setIsWithdrawal(parsed.state.cashflow < 0);
      }
    } catch (err) {
      console.warn('[Rebalance] Failed to load saved state', err);
    } finally {
      savedStateLoaded.current = true;
    }
  }, [holdingsSignature]);

  // Sync local cashflow with global state
  useEffect(() => {
    const newVal = Math.abs(state.cashflow || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    if (newVal !== localCashflow) {
        setLocalCashflow(newVal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cashflow]);

  // Handlers
  const handleWeightChange = (symbol: string, value: string) => {
    const weight = parseFloat(value) || 0;
    setState(prev => recalculateOnWeightChange(prev, symbol, weight));
  };

  const handleQtyChange = (symbol: string, value: string) => {
    const qty = parseInt(value, 10) || 0;
    setState(prev => recalculateOnQtyChange(prev, symbol, qty));
  };

  const handleCashflowChange = (value: string) => {
    const cleanValue = value.replace(/,/g, '');
    const cashflow = parseFloat(cleanValue) || 0;
    // If not withdrawal, positive. If withdrawal, negative.
    const signedCashflow = isWithdrawal ? -Math.abs(cashflow) : Math.abs(cashflow);
    setState(prev => recalculateOnCashflowChange(prev, signedCashflow));
  };

  const handleCashflowCommit = () => {
      handleCashflowChange(localCashflow);
  };

  const handleCashflowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
        (e.currentTarget as HTMLInputElement).blur();
    }
  };

  const handleToggleSign = () => {
    const newIsWithdrawal = !isWithdrawal;
    setIsWithdrawal(newIsWithdrawal);
    // Apply new sign to CURRENT local value (in case user typed but didn't commit)
    const currentAbs = parseFloat(localCashflow.replace(/,/g, '')) || 0;
    const newCashflow = newIsWithdrawal ? -currentAbs : currentAbs;
    setState(prev => recalculateOnCashflowChange(prev, newCashflow));
  };

  const handleToggleLock = (symbol: string) => {
    setState(prev => toggleLock(prev, symbol));
  };

  const handleLockAll = () => {
    const allLocked = state.holdings.every(h => h.isLocked);
    setState(prev => ({
      ...prev,
      holdings: prev.holdings.map(h => ({ ...h, isLocked: !allLocked }))
    }));
  };

  const allLocked = state.holdings.every(h => h.isLocked);

  const handleEquiweight = () => {
    setState(prev => applyEquiweight(prev));
  };

  const handleReset = () => {
    const live = onResetToLive?.();
    if (live) {
      setState(resetToOriginal(live.holdings, live.totalEquity));
      setIsWithdrawal(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(REBALANCE_STORAGE_KEY);
      }
      return;
    }

    setState(resetToOriginal(currentHoldings, totalEquity));
    setIsWithdrawal(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(REBALANCE_STORAGE_KEY);
    }
  };

  const handleSave = () => {
    try {
      if (typeof window === 'undefined') return;
      const payload = { signature: holdingsSignature, state };
      localStorage.setItem(REBALANCE_STORAGE_KEY, JSON.stringify(payload));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.warn('[Rebalance] Failed to save state', err);
    }
  };

  const handleRemove = (symbol: string) => {
    setState(prev => removeStock(prev, symbol));
  };

  const handleAddStock = async (result: StockSearchResult) => {
    // Show local loading state if needed, or rely on async/await
    const price = await getStockPrice(result.symbol);
    if (price) {
      setState(prev => addStock(prev, result.symbol, price, result.sector));
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleCopyTrades = async () => {
    if (summary.actions.length === 0) return;

    const lines = [
      `Rebalance Plan (Net: ${summary.netCashImpact >= 0 ? '+' : ''}${formatCurrency(summary.netCashImpact)})`,
      '----------------------------------------',
      ...summary.actions.map(a => 
        `${a.action.padEnd(4)} ${a.symbol.padEnd(10)} ${String(a.qty).padStart(4)} qty  ${formatCurrency(a.value)}`
      ),
      '----------------------------------------',
      `Total Buy:  ${formatCurrency(summary.totalBuyValue)}`,
      `Total Sell: ${formatCurrency(summary.totalSellValue)}`
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      TransitionComponent={SlideUp}
      PaperProps={{
        className: "glass-card",
        sx: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(11, 15, 25, 0.98)',
          backdropFilter: 'blur(20px)',
        }
      }}
    >
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        
        {/* LEFT PANEL: Table Area (70%) */}
        <Box sx={{ flex: '1 1 70%', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.1)' }}>
          
          {/* Header */}
          <Box sx={{ 
            p: 3, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.05)' 
          }}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
               <FontAwesomeIcon icon={faScaleBalanced} className="text-indigo-400 text-2xl" />
               <Typography variant="h5" className="gradient-text font-bold">Rebalance Portfolio</Typography>
             </Box>

             {/* Stock Search in Header */}
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                 <Box sx={{ width: 300 }}>
                    <Autocomplete
                      freeSolo
                      options={searchResults}
                      getOptionLabel={(option) => 
                        typeof option === 'string' ? option : `${option.symbol} - ${option.sector}`
                      }
                      inputValue={searchQuery}
                      onInputChange={(_, value) => {
                        setSearchQuery(value);
                        if (!value || value.length < 2) {
                          setSearchResults([]);
                        }
                      }}
                      onChange={(_, value) => {
                        if (value && typeof value !== 'string') {
                          handleAddStock(value);
                        }
                      }}
                      loading={searchLoading}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          placeholder="Add Stock (e.g. TCS)"
                          size="small"
                          InputProps={{
                            ...params.InputProps,
                            startAdornment: (
                                <InputAdornment position="start">
                                    <FontAwesomeIcon icon={faPlus} className="text-gray-500" size="sm" />
                                </InputAdornment>
                            ),
                            endAdornment: (
                              <>
                                {searchLoading ? <CircularProgress size={16} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                          sx={{
                            '& .MuiInputBase-root': { 
                                bgcolor: 'rgba(255,255,255,0.03)', 
                                borderRadius: '8px', 
                                fontSize: '0.9rem',
                                color: 'white'
                            },
                            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                          }}
                        />
                      )}
                      renderOption={(props, option) => (
                        <li {...props} key={option.symbol}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span className="font-semibold">{option.symbol}</span>
                            <span className="text-gray-400 text-sm">{option.sector}</span>
                          </Box>
                        </li>
                      )}
                    />
                 </Box>
                 <Tooltip title="Reset">
                   <IconButton onClick={handleReset} size="small" sx={{ height: 32, width: 32, color: '#fb923c', p: 0, borderRadius: 1.5, bgcolor: 'rgba(251, 146, 60, 0.1)', '&:hover': { color: '#fdba74', bgcolor: 'rgba(251, 146, 60, 0.2)' } }}>
                     <FontAwesomeIcon icon={faRotateLeft} size="sm" />
                   </IconButton>
                 </Tooltip>
                 <Tooltip title={saveSuccess ? "Saved!" : "Save"}>
                   <IconButton
                     onClick={handleSave}
                     size="small"
                     sx={{ height: 32, width: 32, color: saveSuccess ? '#4ade80' : '#22d3ee', p: 0, borderRadius: 1.5, bgcolor: saveSuccess ? 'rgba(74, 222, 128, 0.1)' : 'rgba(34, 211, 238, 0.12)', '&:hover': { bgcolor: saveSuccess ? 'rgba(74, 222, 128, 0.2)' : 'rgba(34, 211, 238, 0.2)' } }}
                   >
                     <FontAwesomeIcon icon={faFloppyDisk} size="sm" />
                   </IconButton>
                 </Tooltip>
                 <Tooltip title="Equiweight">
                   <IconButton onClick={handleEquiweight} size="small" sx={{ height: 32, width: 32, color: '#818cf8', p: 0, borderRadius: 1.5, bgcolor: 'rgba(99, 102, 241, 0.1)', '&:hover': { bgcolor: 'rgba(99, 102, 241, 0.2)' } }}>
                     <FontAwesomeIcon icon={faScaleBalanced} size="sm" />
                   </IconButton>
                 </Tooltip>
                 <IconButton onClick={onClose} sx={{ color: '#9ca3af', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' } }}>
                    <FontAwesomeIcon icon={faXmark} size="sm" />
                 </IconButton>
             </Box>
          </Box>

          {/* Table Container - Flex Grow to take remaining height */}
          <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <StyledHeaderCell width={50} align="center">
                    <Tooltip title={allLocked ? "Unlock All" : "Lock All"}>
                      <Checkbox
                        checked={allLocked}
                        onChange={handleLockAll}
                        icon={<FontAwesomeIcon icon={faLockOpen} className="text-gray-600" />}
                        checkedIcon={<FontAwesomeIcon icon={faLock} className="text-amber-400" />}
                        size="small"
                        sx={{ p: 0 }}
                      />
                    </Tooltip>
                  </StyledHeaderCell>
                  <StyledHeaderCell sx={{ cursor: 'pointer', '&:hover': { color: '#818cf8' } }} onClick={() => toggleSort('symbol')}>
                    Stock {sortBy === 'symbol' && (sortDir === 'asc' ? '↑' : '↓')}
                  </StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP</StyledHeaderCell>
                  <StyledHeaderCell align="right">Cur. Qty</StyledHeaderCell>
                  <StyledHeaderCell align="right" sx={{ cursor: 'pointer', '&:hover': { color: '#818cf8' } }} onClick={() => toggleSort('weight')}>
                    Cur. Wt% {sortBy === 'weight' && (sortDir === 'asc' ? '↑' : '↓')}
                  </StyledHeaderCell>
                  <StyledHeaderCell align="center" width={110}>Target Qty</StyledHeaderCell>
                  <StyledHeaderCell align="center" width={110}>Target Wt%</StyledHeaderCell>
                  <StyledHeaderCell align="center" width={100}>Diff</StyledHeaderCell>
                  <StyledHeaderCell width={50}></StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedHoldings.map((h) => {
                  const qtyDiff = h.targetQty - h.currentQty;
                  
                  return (
                    <StyledTableRow key={h.symbol}>
                      <StyledCell align="center">
                        <Checkbox
                          checked={h.isLocked}
                          onChange={() => handleToggleLock(h.symbol)}
                          icon={<FontAwesomeIcon icon={faLockOpen} className="text-gray-600" />}
                          checkedIcon={<FontAwesomeIcon icon={faLock} className="text-amber-400" />}
                          size="small"
                          sx={{ p: 0 }}
                        />
                      </StyledCell>
                      <StyledCell>
                        <Typography variant="body2" component="div" sx={{ fontWeight: 600, color: '#fff', fontSize: '0.9rem' }}>
                          {h.symbol}
                          {h.isNew && (
                            <Chip 
                              label="NEW" 
                              size="small" 
                              sx={{ ml: 1, height: 16, fontSize: '0.6rem', bgcolor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }} 
                            />
                          )}
                        </Typography>
                        {/* Sector info removed as requested */}
                      </StyledCell>
                      <StyledCell align="right" sx={{ color: '#9ca3af' }}>{formatCurrency(h.price)}</StyledCell>
                      <StyledCell align="right" sx={{ color: '#9ca3af' }}>{formatNumber(h.currentQty, 0)}</StyledCell>
                      <StyledCell align="right" sx={{ color: '#9ca3af' }}>{h.currentWeight.toFixed(2)}%</StyledCell>
                      <StyledCell align="center">
                        <BufferedNumberInput
                          value={h.targetQty}
                          onChange={(val) => handleQtyChange(h.symbol, val)}
                          disabled={h.isLocked}
                          decimalPlaces={0}
                          step={1}
                          min={0}
                          max={999999}
                          width={90}
                          endAdornment={null}
                        />
                      </StyledCell>
                      <StyledCell align="center">
                        <BufferedNumberInput
                          value={h.targetWeight}
                          onChange={(val) => handleWeightChange(h.symbol, val)}
                          disabled={h.isLocked}
                        />
                      </StyledCell>
                      <StyledCell align="center">
                         {(qtyDiff !== 0) && (
                             <Typography variant="body2" sx={{ 
                                 fontWeight: 600,
                                 color: qtyDiff > 0 ? '#4ade80' : '#f87171'
                             }}>
                                  {qtyDiff > 0 ? '+' : ''}
                                  <AnimatedNumber value={qtyDiff} format={(v) => Math.round(v).toString()} />
                             </Typography>
                         )}
                      </StyledCell>
                      <StyledCell>
                        <IconButton 
                          size="small" 
                          onClick={() => handleRemove(h.symbol)}
                          sx={{ color: '#4b5563', '&:hover': { color: '#f87171' } }}
                        >
                          <FontAwesomeIcon icon={faTrash} size="sm" />
                        </IconButton>
                      </StyledCell>
                    </StyledTableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Box>

        {/* RIGHT PANEL: Controls & Summary (30%) */}
        <Box sx={{ flex: '1 1 30%', display: 'flex', flexDirection: 'column', bgcolor: 'rgba(5, 7, 10, 0.95)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
           
           {/* 1. HEADER & CONTROLS (Compact & Receded) */}
           <Box sx={{ p: 2, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {/* Stats Row */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                 <Box>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', lineHeight: 1 }}>Current</Typography>
                    <Typography variant="h5" sx={{ color: '#fff', fontWeight: 700, lineHeight: 1.2 }}>{formatCurrency(state.totalEquity)}</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" sx={{ color: '#6b7280', display: 'block', lineHeight: 1 }}>Net Change</Typography>
                    <Typography variant="h6" sx={{ color: summary.netCashImpact >= 0 ? '#4ade80' : '#f87171', fontWeight: 600, lineHeight: 1.2 }}>
                        <AnimatedNumber value={summary.netCashImpact} format={formatCurrency} />
                    </Typography>
                 </Box>
              </Box>

              {/* Controls (Integrated Row) */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                   {/* Cashflow Input */}
                   <Box sx={{ display: 'flex', gap: 0, flex: 1 }}>
                        <Button
                            size="small"
                            onClick={() => handleToggleSign()}
                            sx={{ 
                                minWidth: 32,
                                height: 36,
                                px: 0,
                                borderRadius: '6px 0 0 6px',
                                bgcolor: !isWithdrawal ? 'rgba(34, 197, 94, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                                color: !isWithdrawal ? '#4ade80' : '#f87171',
                                border: '1px solid',
                                borderColor: !isWithdrawal ? 'rgba(34, 197, 94, 0.2)' : 'rgba(248, 113, 113, 0.2)',
                                '&:hover': { 
                                    bgcolor: !isWithdrawal ? 'rgba(34, 197, 94, 0.25)' : 'rgba(248, 113, 113, 0.25)' 
                                }
                            }}
                        >
                            <FontAwesomeIcon icon={!isWithdrawal ? faPlus : faMinus} size="xs" />
                        </Button>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Cash"
                            value={localCashflow}
                            onChange={(e) => setLocalCashflow(e.target.value)}
                            onBlur={handleCashflowCommit}
                            onKeyDown={handleCashflowKeyDown}
                            InputProps={{
                                startAdornment: <Typography sx={{ color: '#9ca3af', mr: 0.5, fontSize: '0.8rem' }}>₹</Typography>
                            }}
                            sx={{
                                ...hideSpinners,
                                '& .MuiInputBase-root': { 
                                    bgcolor: 'rgba(255,255,255,0.03)', 
                                    color: '#fff', 
                                    fontSize: '0.9rem',
                                    borderRadius: '0 6px 6px 0',
                                    pl: 1,
                                    height: 36
                                },
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' }
                            }}
                        />
                   </Box>

                   {/* Diff Threshold */}
                   <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                       <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.7rem' }}>Diff</Typography>
                       <BufferedNumberInput
                            value={state.diffThreshold}
                            onChange={(val) => setState(prev => setDiffThreshold(prev, parseFloat(val) || 0))}
                            step={0.001}
                            decimalPlaces={3}
                            width={75}
                            height={36}
                            fontSize="0.7rem"
                            endAdornment={null}
                            startAdornment={<Typography sx={{ color: '#9ca3af', width: 16, textAlign: 'center', fontSize: '0.7rem', fontWeight: 700 }}>&gt;</Typography>}
                        />
                   </Box>

                   {/* Copy Trades Button */}
                   <Tooltip title={copySuccess ? "Copied!" : "Copy Trades"}>
                        <IconButton 
                           onClick={handleCopyTrades} 
                           disabled={summary.actions.length === 0}
                           size="small" 
                           sx={{ 
                               height: 36,
                               width: 36,
                               color: copySuccess ? '#4ade80' : '#a5b4fc', 
                               p: 0, 
                               borderRadius: 1.5, 
                               bgcolor: copySuccess ? 'rgba(74, 222, 128, 0.1)' : 'rgba(99, 102, 241, 0.1)', 
                               '&:hover': { bgcolor: copySuccess ? 'rgba(74, 222, 128, 0.2)' : 'rgba(99, 102, 241, 0.2)' },
                               opacity: summary.actions.length === 0 ? 0.5 : 1
                           }}
                       >
                           <FontAwesomeIcon icon={faCopy} size="xs" />
                       </IconButton>
                   </Tooltip>
              </Box>
           </Box>
           
           {/* 2. ORDER BOOK (Prominent) */}
           <Box sx={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', bgcolor: 'rgba(0,0,0,0.2)' }}>
               <Box sx={{ p: 2, pb: 1, pt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <Typography variant="caption" sx={{ color: '#9ca3af', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                        Proposed Trades
                    </Typography>
                    <Chip label={summary.actions.length} size="small" sx={{ height: 18, bgcolor: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc', fontWeight: 700, fontSize: '0.7rem' }} />
               </Box>

               {/* Scrollable Area */}
               <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2, pt: 0 }}>
                   {summary.warnings.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 2, py: 0, bgcolor: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.2)', '& .MuiAlert-message': { py: 1 } }}>
                            {summary.warnings.map((w, i) => <div key={i} className="text-xs">{w}</div>)}
                        </Alert>
                   )}

                   {summary.actions.length === 0 ? (
                       <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#4b5563', gap: 1, opacity: 0.5 }}>
                           <FontAwesomeIcon icon={faScaleBalanced} size="2x" />
                           <Typography variant="body2">Portfolio Balanced</Typography>
                       </Box>
                   ) : (
                       <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                           {summary.actions.map((a) => (
                                <Box key={a.symbol} sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: 'minmax(0, 1fr) 80px 200px',
                                    gap: 1,
                                    alignItems: 'center',
                                   py: 0.5,
                                   px: 1,
                                   borderRadius: 1,
                                   bgcolor: a.action === 'BUY' ? 'rgba(74, 222, 128, 0.05)' : 'rgba(248, 113, 113, 0.05)',
                                   border: '1px solid',
                                   borderColor: a.action === 'BUY' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                                   transition: 'all 0.15s',
                                   '&:hover': { bgcolor: a.action === 'BUY' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)', borderColor: a.action === 'BUY' ? 'rgba(74, 222, 128, 0.25)' : 'rgba(248, 113, 113, 0.25)' }
                               }}>
                                   {/* Left: Symbol */}
                                   <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <Typography variant="body2" sx={{ color: '#fff', fontWeight: 600, fontSize: '0.75rem', lineHeight: 1 }}>{a.symbol}</Typography>
                                   </Box>
                                    
                                   {/* Center: Qty */}
                                   <Box sx={{ textAlign: 'right' }}>
                                        <Typography sx={{ 
                                            color: a.action === 'BUY' ? '#4ade80' : '#f87171',
                                            fontWeight: 700,
                                            fontSize: '0.85rem',
                                            lineHeight: 1,
                                            fontFamily: 'monospace'
                                        }}>
                                            {a.action === 'SELL' ? '-' : '+'}<AnimatedNumber value={a.qty} format={(v) => Math.round(v).toString()} />
                                        </Typography>
                                   </Box>
                                    
                                   {/* Right: Value */}
                                   <Box sx={{ textAlign: 'right' }}>
                                        <Typography sx={{ 
                                            color: a.action === 'BUY' ? '#4ade80' : '#f87171',
                                            fontWeight: 600,
                                            fontSize: '0.85rem',
                                            lineHeight: 1.2
                                        }}>
                                            {a.action === 'SELL' ? '-' : ''}<AnimatedNumber value={a.value} format={formatCurrency} />
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: '#6b7280', fontSize: '0.6rem', lineHeight: 1 }}>
                                            @ <AnimatedNumber value={a.value/a.qty} format={formatCurrency} />
                                        </Typography>
                                   </Box>
                               </Box>
                           ))}
                       </Box>
                   )}
               </Box>
           </Box>


        </Box>
      </Box>
    </Dialog>
  );
}
