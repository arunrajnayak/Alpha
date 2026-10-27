'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Popover from '@mui/material/Popover';
import Chip from '@mui/material/Chip';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRotateRight, 
  faBolt, 
  faPlus, 
  faMinus, 
  faCoins, 
  faChartSimple,
  faArrowLeft
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { RebalanceOrderItem, RebalancePreflightSummary } from '@/lib/types';
import type { RebalanceAction } from '@/lib/rebalance';
import { getRebalancePreflightAction } from '@/app/actions/zerodha-orders';
import MarketDepthPanel from './MarketDepthPanel';

const StyledHeaderCell = styled(TableCell)(() => ({
  backgroundColor: '#0f172a',
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  padding: '8px 12px',
  zIndex: 2,
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

interface RebalanceRefineStepProps {
  actions: RebalanceAction[];
  priceMap?: Record<string, number>;
  orders: RebalanceOrderItem[];
  onUpdateOrders: (orders: RebalanceOrderItem[]) => void;
  onBackToPlan: () => void;
  onProceedToExecute: (finalOrders: RebalanceOrderItem[]) => void;
  isExecuting?: boolean;
}

export default function RebalanceRefineStep({
  actions,
  priceMap,
  orders,
  onUpdateOrders,
  onBackToPlan,
  onProceedToExecute,
  isExecuting = false,
}: RebalanceRefineStepProps) {
  const [preflight, setPreflight] = useState<RebalancePreflightSummary | null>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [depthAnchorEl, setDepthAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedDepthSymbol, setSelectedDepthSymbol] = useState<string | null>(null);

  const handleOpenDepth = (e: React.MouseEvent<HTMLElement>, symbol: string) => {
    if (selectedDepthSymbol === symbol && depthAnchorEl) {
      setDepthAnchorEl(null);
      setSelectedDepthSymbol(null);
    } else {
      setDepthAnchorEl(e.currentTarget);
      setSelectedDepthSymbol(symbol);
    }
  };

  const handleCloseDepth = () => {
    setDepthAnchorEl(null);
    setSelectedDepthSymbol(null);
  };

  // Load preflight calculation
  const loadPreflight = useCallback(async (ordersList?: RebalanceOrderItem[]) => {
    setIsLoadingPreflight(true);
    setPreflightError(null);
    try {
      const input = ordersList && ordersList.length > 0 ? ordersList : orders.length > 0 ? orders : actions;
      const res = await getRebalancePreflightAction(input, priceMap);
      if (res.success) {
        setPreflight(res.data);
        if (orders.length === 0) {
          onUpdateOrders(res.data.orders);
        }
      } else {
        setPreflightError(res.error);
      }
    } catch (err) {
      setPreflightError(err instanceof Error ? err.message : 'Failed to fetch preflight data');
    } finally {
      setIsLoadingPreflight(false);
    }
  }, [actions, orders, priceMap, onUpdateOrders]);

  useEffect(() => {
    loadPreflight();
  }, [loadPreflight]);

  // Order modification handlers
  const updateOrderPrice = (symbol: string, newPrice: number) => {
    const validPrice = Math.max(0.05, Math.round(newPrice / 0.05) * 0.05);
    const fixedPrice = Number(validPrice.toFixed(2));

    const next = orders.map(o => o.symbol === symbol ? { ...o, price: fixedPrice } : o);
    onUpdateOrders(next);
    loadPreflight(next);
  };

  const stepOrderPrice = (symbol: string, delta: number) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    updateOrderPrice(symbol, o.price + delta);
  };

  const resetOrderToLtp = (symbol: string) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    updateOrderPrice(symbol, o.currentPrice);
  };

  const updateOrderQuantity = (symbol: string, newQty: number) => {
    const validQty = Math.max(1, Math.round(newQty));
    const next = orders.map(o => o.symbol === symbol ? { ...o, quantity: validQty } : o);
    onUpdateOrders(next);
    loadPreflight(next);
  };

  const stepOrderQuantity = (symbol: string, delta: number) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    updateOrderQuantity(symbol, o.quantity + delta);
  };

  // Optimistic totals computed directly from current orders state
  const sellOrders = useMemo(() => orders.filter(o => o.transactionType === 'SELL'), [orders]);
  const buyOrders = useMemo(() => orders.filter(o => o.transactionType === 'BUY'), [orders]);

  const liveTotalSell = useMemo(() => 
    sellOrders.reduce((sum, o) => sum + (o.quantity * o.price), 0), 
    [sellOrders]
  );
  const liveTotalBuy = useMemo(() => 
    buyOrders.reduce((sum, o) => sum + (o.quantity * o.price), 0), 
    [buyOrders]
  );
  const liveNetCashImpact = liveTotalSell - liveTotalBuy;

  const availableCash = preflight?.availableCash ?? 0;
  const isMarginSufficient = availableCash + liveTotalSell >= liveTotalBuy;
  const marginShortfall = Math.max(0, liveTotalBuy - (availableCash + liveTotalSell));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Main Content Area */}
      <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {preflightError && (
          <Alert severity="warning" sx={{ bgcolor: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            {preflightError}
          </Alert>
        )}

        {/* Financial Summary Dashboard */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, 
          gap: 1.5 
        }}>
          {/* Sell Proceeds */}
          <Box sx={{ 
            p: 2, 
            borderRadius: 2, 
            bgcolor: 'rgba(30, 41, 59, 0.4)', 
            border: liveTotalSell > 0 ? '1px solid rgba(248, 113, 113, 0.25)' : '1px solid rgba(255,255,255,0.06)',
            opacity: liveTotalSell > 0 ? 1 : 0.6
          }}>
            <Typography variant="caption" sx={{ color: liveTotalSell > 0 ? '#f87171' : '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              Sell Proceeds
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              +{formatCurrency(liveTotalSell)}
            </Typography>
          </Box>

          {/* Buy Outlay */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(74, 222, 128, 0.25)' }}>
            <Typography variant="caption" sx={{ color: '#4ade80', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              Buy Outlay
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              -{formatCurrency(liveTotalBuy)}
            </Typography>
          </Box>

          {/* Net Cash Flow */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              Net Cash Impact
            </Typography>
            <Typography sx={{ 
              color: liveNetCashImpact >= 0 ? '#4ade80' : '#fbbf24', 
              fontSize: '1.1rem', 
              fontWeight: 700, 
              mt: 0.5 
            }}>
              {liveNetCashImpact >= 0 ? '+' : ''}{formatCurrency(liveNetCashImpact)}
            </Typography>
          </Box>

          {/* Available Cash */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Zerodha Cash
              </Typography>
              <Tooltip title="Refresh margins">
                <IconButton 
                  size="small" 
                  onClick={() => loadPreflight(orders)} 
                  disabled={isLoadingPreflight || isExecuting}
                  sx={{ p: 0.2, color: '#9ca3af', '&:hover': { color: '#60a5fa' } }}
                >
                  {isLoadingPreflight ? <CircularProgress size={10} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: '0.65rem' }} />}
                </IconButton>
              </Tooltip>
            </Box>
            <Typography sx={{ color: '#60a5fa', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              {formatCurrency(availableCash)}
            </Typography>
          </Box>

          {/* Margin Adequacy */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              Margin Status
            </Typography>
            <Typography sx={{ 
              color: isMarginSufficient ? '#4ade80' : '#fbbf24', 
              fontSize: '1.1rem', 
              fontWeight: 700, 
              mt: 0.5 
            }}>
              {isMarginSufficient ? 'Sufficient' : `Shortfall: ${formatCurrency(marginShortfall)}`}
            </Typography>
          </Box>

          {/* Estimated Taxes & Fees */}
          <Tooltip title={
            <Box sx={{ p: 0.5, fontSize: '0.7rem' }}>
              <div>STT: {formatCurrency(preflight?.charges.stt || 0)}</div>
              <div>Brokerage: ₹0.00 (Zerodha Delivery)</div>
              <div>Exchange Fees: {formatCurrency(preflight?.charges.exchangeTurnover || 0)}</div>
              <div>GST: {formatCurrency(preflight?.charges.gst || 0)}</div>
              <div>Stamp Duty: {formatCurrency(preflight?.charges.stampDuty || 0)}</div>
              <div>SEBI Charges: {formatCurrency(preflight?.charges.sebiCharges || 0)}</div>
            </Box>
          }>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FontAwesomeIcon icon={faCoins} size="xs" /> Est. Taxes & Fees
              </Typography>
              <Typography sx={{ color: '#cbd5e1', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {formatCurrency(preflight?.charges.totalCharges || 0)}
              </Typography>
            </Box>
          </Tooltip>
        </Box>

        {/* STEP 2A: SELL ORDERS TABLE */}
        {sellOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(248, 113, 113, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(239, 68, 68, 0.08)', borderBottom: '1px solid rgba(248, 113, 113, 0.15)', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#f87171' }}>
                Sell Orders
              </Typography>
              <Chip 
                label={sellOrders.length} 
                size="small" 
                sx={{ 
                  height: 18, 
                  fontSize: '0.7rem', 
                  fontWeight: 700, 
                  bgcolor: 'rgba(239, 68, 68, 0.15)', 
                  color: '#f87171',
                  border: '1px solid rgba(248, 113, 113, 0.25)',
                }} 
              />
            </Box>

            <Box sx={{ 
              maxHeight: 280, 
              overflowY: 'auto',
              overflowX: 'auto',
              '&::-webkit-scrollbar': { width: 6, height: 6 },
              '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 3 },
              '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
            }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <StyledHeaderCell>Stock</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 170 }}>Quantity</StyledHeaderCell>
                    <StyledHeaderCell align="right">LTP</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 230 }}>Limit Price</StyledHeaderCell>
                    <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 110 }}>Depth</StyledHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sellOrders.map((o) => {
                    const isDepthOpen = selectedDepthSymbol === o.symbol && Boolean(depthAnchorEl);

                    return (
                      <StyledTableRow key={o.symbol}>
                        {/* Stock */}
                        <StyledCell>
                          <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                        </StyledCell>

                        {/* Quantity Stepper */}
                        <StyledCell align="center">
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(248, 113, 113, 0.25)', borderRadius: 1.5, p: '2px' }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, -1)}
                              disabled={o.quantity <= 1 || isExecuting}
                              sx={{ color: '#f87171', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.15)' } }}
                            >
                              <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.65rem' }} />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.quantity}
                              onChange={(e) => updateOrderQuantity(o.symbol, parseInt(e.target.value) || 1)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { 
                                  min: 1, 
                                  style: { 
                                    textAlign: 'center', 
                                    padding: '2px 4px', 
                                    fontSize: '0.8rem', 
                                    fontFamily: 'monospace', 
                                    fontWeight: 700, 
                                    width: 52,
                                    color: '#f87171' 
                                  } 
                                }
                              }}
                              sx={{ 
                                '& .MuiOutlinedInput-root': {
                                  '& fieldset': { border: 'none' },
                                }
                              }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, 1)}
                              disabled={isExecuting}
                              sx={{ color: '#f87171', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.15)' } }}
                            >
                              <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.65rem' }} />
                            </IconButton>
                          </Box>
                        </StyledCell>

                        {/* LTP */}
                        <StyledCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: '0.8rem' }}>
                            {formatCurrency(o.currentPrice)}
                          </Typography>
                        </StyledCell>

                        {/* Limit Price Stepper */}
                        <StyledCell align="right">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75 }}>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1.5, p: '2px' }}>
                              <IconButton 
                                size="small" 
                                onClick={() => stepOrderPrice(o.symbol, -0.05)}
                                disabled={isExecuting}
                                sx={{ color: '#9ca3af', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
                              >
                                <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.65rem' }} />
                              </IconButton>
                              <TextField
                                size="small"
                                type="number"
                                value={o.price}
                                onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                                disabled={isExecuting}
                                slotProps={{
                                  htmlInput: { 
                                    step: 0.05, 
                                    style: { 
                                      textAlign: 'right', 
                                      padding: '2px 6px', 
                                      fontSize: '0.8rem', 
                                      fontFamily: 'monospace',
                                      fontWeight: 600,
                                      width: 74,
                                      color: '#fff'
                                    } 
                                  }
                                }}
                                sx={{ 
                                  '& .MuiOutlinedInput-root': {
                                    '& fieldset': { border: 'none' },
                                  }
                                }}
                              />
                              <IconButton 
                                size="small" 
                                onClick={() => stepOrderPrice(o.symbol, 0.05)}
                                disabled={isExecuting}
                                sx={{ color: '#9ca3af', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
                              >
                                <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.65rem' }} />
                              </IconButton>
                            </Box>
                            <Tooltip title="Reset to LTP">
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => resetOrderToLtp(o.symbol)}
                                disabled={isExecuting}
                                sx={{ 
                                  minWidth: 32, 
                                  height: 28, 
                                  px: 0.75, 
                                  fontSize: '0.65rem', 
                                  fontWeight: 700, 
                                  color: '#60a5fa', 
                                  bgcolor: 'rgba(96, 165, 250, 0.1)', 
                                  border: '1px solid rgba(96, 165, 250, 0.2)',
                                  borderRadius: 1,
                                  '&:hover': { bgcolor: 'rgba(96, 165, 250, 0.2)' }
                                }}
                              >
                                LTP
                              </Button>
                            </Tooltip>
                          </Box>
                        </StyledCell>

                        {/* Total Value */}
                        <StyledCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#f87171' }}>
                            {formatCurrency(o.quantity * o.price)}
                          </Typography>
                        </StyledCell>

                        {/* Depth Toggle */}
                        <StyledCell align="center">
                          <Button
                            size="small"
                            variant={isDepthOpen ? 'contained' : 'outlined'}
                            onClick={(e) => handleOpenDepth(e, o.symbol)}
                            startIcon={<FontAwesomeIcon icon={faChartSimple} style={{ fontSize: '0.7rem' }} />}
                            sx={{
                              fontSize: '0.7rem',
                              height: 28,
                              textTransform: 'none',
                              px: 1.2,
                              bgcolor: isDepthOpen ? '#2563eb' : 'rgba(255,255,255,0.03)',
                              borderColor: isDepthOpen ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                              color: isDepthOpen ? '#fff' : '#9ca3af',
                              borderRadius: 1,
                              '&:hover': {
                                bgcolor: isDepthOpen ? '#1d4ed8' : 'rgba(255,255,255,0.08)',
                                color: '#fff',
                                borderColor: 'rgba(255,255,255,0.25)',
                              }
                            }}
                          >
                            Depth
                          </Button>
                        </StyledCell>
                      </StyledTableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}

        {/* STEP 2B: BUY ORDERS TABLE */}
        {buyOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(74, 222, 128, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(34, 197, 94, 0.08)', borderBottom: '1px solid rgba(74, 222, 128, 0.15)', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80' }}>
                Buy Orders
              </Typography>
              <Chip 
                label={buyOrders.length} 
                size="small" 
                sx={{ 
                  height: 18, 
                  fontSize: '0.7rem', 
                  fontWeight: 700, 
                  bgcolor: 'rgba(34, 197, 94, 0.15)', 
                  color: '#4ade80',
                  border: '1px solid rgba(74, 222, 128, 0.25)',
                }} 
              />
            </Box>

            <Box sx={{ 
              maxHeight: 280, 
              overflowY: 'auto',
              overflowX: 'auto',
              '&::-webkit-scrollbar': { width: 6, height: 6 },
              '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 3 },
              '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
            }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <StyledHeaderCell>Stock</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 170 }}>Quantity</StyledHeaderCell>
                    <StyledHeaderCell align="right">LTP</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 230 }}>Limit Price</StyledHeaderCell>
                    <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 110 }}>Depth</StyledHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {buyOrders.map((o) => {
                    const isDepthOpen = selectedDepthSymbol === o.symbol && Boolean(depthAnchorEl);

                    return (
                      <StyledTableRow key={o.symbol}>
                        {/* Stock */}
                        <StyledCell>
                          <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                        </StyledCell>

                        {/* Quantity Stepper */}
                        <StyledCell align="center">
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(74, 222, 128, 0.25)', borderRadius: 1.5, p: '2px' }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, -1)}
                              disabled={o.quantity <= 1 || isExecuting}
                              sx={{ color: '#4ade80', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(74, 222, 128, 0.15)' } }}
                            >
                              <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.65rem' }} />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.quantity}
                              onChange={(e) => updateOrderQuantity(o.symbol, parseInt(e.target.value) || 1)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { 
                                  min: 1, 
                                  style: { 
                                    textAlign: 'center', 
                                    padding: '2px 4px', 
                                    fontSize: '0.8rem', 
                                    fontFamily: 'monospace', 
                                    fontWeight: 700, 
                                    width: 52,
                                    color: '#4ade80' 
                                  } 
                                }
                              }}
                              sx={{ 
                                '& .MuiOutlinedInput-root': {
                                  '& fieldset': { border: 'none' },
                                }
                              }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, 1)}
                              disabled={isExecuting}
                              sx={{ color: '#4ade80', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(74, 222, 128, 0.15)' } }}
                            >
                              <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.65rem' }} />
                            </IconButton>
                          </Box>
                        </StyledCell>

                        {/* LTP */}
                        <StyledCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: '0.8rem' }}>
                            {formatCurrency(o.currentPrice)}
                          </Typography>
                        </StyledCell>

                        {/* Limit Price Stepper */}
                        <StyledCell align="right">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75 }}>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1.5, p: '2px' }}>
                              <IconButton 
                                size="small" 
                                onClick={() => stepOrderPrice(o.symbol, -0.05)}
                                disabled={isExecuting}
                                sx={{ color: '#9ca3af', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
                              >
                                <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.65rem' }} />
                              </IconButton>
                              <TextField
                                size="small"
                                type="number"
                                value={o.price}
                                onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                                disabled={isExecuting}
                                slotProps={{
                                  htmlInput: { 
                                    step: 0.05, 
                                    style: { 
                                      textAlign: 'right', 
                                      padding: '2px 6px', 
                                      fontSize: '0.8rem', 
                                      fontFamily: 'monospace',
                                      fontWeight: 600,
                                      width: 74,
                                      color: '#fff'
                                    } 
                                  }
                                }}
                                sx={{ 
                                  '& .MuiOutlinedInput-root': {
                                    '& fieldset': { border: 'none' },
                                  }
                                }}
                              />
                              <IconButton 
                                size="small" 
                                onClick={() => stepOrderPrice(o.symbol, 0.05)}
                                disabled={isExecuting}
                                sx={{ color: '#9ca3af', width: 24, height: 24, borderRadius: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
                              >
                                <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.65rem' }} />
                              </IconButton>
                            </Box>
                            <Tooltip title="Reset to LTP">
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => resetOrderToLtp(o.symbol)}
                                disabled={isExecuting}
                                sx={{ 
                                  minWidth: 32, 
                                  height: 28, 
                                  px: 0.75, 
                                  fontSize: '0.65rem', 
                                  fontWeight: 700, 
                                  color: '#60a5fa', 
                                  bgcolor: 'rgba(96, 165, 250, 0.1)', 
                                  border: '1px solid rgba(96, 165, 250, 0.2)',
                                  borderRadius: 1,
                                  '&:hover': { bgcolor: 'rgba(96, 165, 250, 0.2)' }
                                }}
                              >
                                LTP
                              </Button>
                            </Tooltip>
                          </Box>
                        </StyledCell>

                        {/* Total Value */}
                        <StyledCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#4ade80' }}>
                            {formatCurrency(o.quantity * o.price)}
                          </Typography>
                        </StyledCell>

                        {/* Depth Toggle */}
                        <StyledCell align="center">
                          <Button
                            size="small"
                            variant={isDepthOpen ? 'contained' : 'outlined'}
                            onClick={(e) => handleOpenDepth(e, o.symbol)}
                            startIcon={<FontAwesomeIcon icon={faChartSimple} style={{ fontSize: '0.7rem' }} />}
                            sx={{
                              fontSize: '0.7rem',
                              height: 28,
                              textTransform: 'none',
                              px: 1.2,
                              bgcolor: isDepthOpen ? '#2563eb' : 'rgba(255,255,255,0.03)',
                              borderColor: isDepthOpen ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                              color: isDepthOpen ? '#fff' : '#9ca3af',
                              borderRadius: 1,
                              '&:hover': {
                                bgcolor: isDepthOpen ? '#1d4ed8' : 'rgba(255,255,255,0.08)',
                                color: '#fff',
                                borderColor: 'rgba(255,255,255,0.25)',
                              }
                            }}
                          >
                            Depth
                          </Button>
                        </StyledCell>
                      </StyledTableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}
      </Box>

      {/* Market Depth Popover Overlay */}
      <Popover
        open={Boolean(depthAnchorEl && selectedDepthSymbol)}
        anchorEl={depthAnchorEl}
        onClose={handleCloseDepth}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              bgcolor: 'transparent',
              boxShadow: 'none',
              border: 'none',
              backgroundImage: 'none',
              overflow: 'visible',
            }
          }
        }}
      >
        {selectedDepthSymbol && (
          <MarketDepthPanel
            symbol={selectedDepthSymbol}
            onClose={handleCloseDepth}
            onSelectPrice={(price) => {
              updateOrderPrice(selectedDepthSymbol, price);
              handleCloseDepth();
            }}
          />
        )}
      </Popover>

      {/* Footer Navigation Bar */}
      <Box sx={{ 
        px: { xs: 2, sm: 3 }, 
        py: 1.5, 
        borderTop: '1px solid rgba(255,255,255,0.08)', 
        bgcolor: 'rgba(15, 23, 42, 0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5
      }}>
        <Button
          variant="outlined"
          size="small"
          onClick={onBackToPlan}
          startIcon={<FontAwesomeIcon icon={faArrowLeft} size="xs" />}
          sx={{
            textTransform: 'none',
            height: 38,
            fontSize: '0.8rem',
            borderColor: 'rgba(255,255,255,0.15)',
            color: '#d1d5db',
            borderRadius: 1.5,
            '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.05)' }
          }}
        >
          Back to Plan
        </Button>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="contained"
            onClick={() => onProceedToExecute(orders)}
            disabled={orders.length === 0 || isExecuting}
            startIcon={isExecuting ? <CircularProgress size={14} color="inherit" /> : <FontAwesomeIcon icon={faBolt} size="xs" />}
            sx={{
              textTransform: 'none',
              height: 38,
              px: 3.5,
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.01em',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
              borderRadius: 1.5,
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.4)',
              transition: 'all 0.15s ease-in-out',
              '&:hover': { 
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                boxShadow: '0 6px 20px 0 rgba(37, 99, 235, 0.55)',
                transform: 'translateY(-1px)',
              },
              '&:active': {
                transform: 'translateY(0)',
              },
              '&.Mui-disabled': {
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#64748b',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                boxShadow: 'none',
              }
            }}
          >
            {isExecuting ? 'Executing...' : 'Execute Rebalance'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
