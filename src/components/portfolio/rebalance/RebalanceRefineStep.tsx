'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Collapse from '@mui/material/Collapse';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRotateRight, 
  faBolt, 
  faPlus, 
  faMinus, 
  faCoins, 
  faChevronDown, 
  faChevronUp,
  faArrowLeft,
  faCheck,
  faTriangleExclamation
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
  const [expandedDepthSymbol, setExpandedDepthSymbol] = useState<string | null>(null);

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
      {/* Subheader: Session Status & Refresh */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        px: { xs: 2, sm: 3 }, 
        py: 1.2, 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        bgcolor: 'rgba(15, 23, 42, 0.4)' 
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {preflight?.hasActiveSession ? (
            <Chip
              size="small"
              icon={<FontAwesomeIcon icon={faCheck} size="xs" style={{ color: 'inherit' }} />}
              label="Zerodha Session Active"
              sx={{
                height: 22,
                fontSize: '0.65rem',
                fontWeight: 700,
                bgcolor: 'rgba(34, 197, 94, 0.15)',
                color: '#4ade80',
                border: '1px solid rgba(34, 197, 94, 0.3)'
              }}
            />
          ) : (
            <Chip
              size="small"
              icon={<FontAwesomeIcon icon={faTriangleExclamation} size="xs" style={{ color: 'inherit' }} />}
              label="Zerodha Disconnected"
              sx={{
                height: 22,
                fontSize: '0.65rem',
                fontWeight: 700,
                bgcolor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}
            />
          )}
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem', display: { xs: 'none', md: 'block' } }}>
            SELL orders are executed first to release margin · Refine quantities, limit prices, or inspect market depth
          </Typography>
        </Box>

        <Button
          size="small"
          variant="outlined"
          onClick={() => loadPreflight(orders)}
          disabled={isLoadingPreflight || isExecuting}
          startIcon={isLoadingPreflight ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} size="xs" />}
          sx={{
            color: '#d1d5db',
            borderColor: 'rgba(255,255,255,0.15)',
            textTransform: 'none',
            fontSize: '0.75rem',
            height: 30,
            '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.03)' }
          }}
        >
          Refresh Margins
        </Button>
      </Box>

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
          {/* 1. Sell Proceeds */}
          <Box sx={{ 
            p: 2, 
            borderRadius: 2, 
            bgcolor: 'rgba(30, 41, 59, 0.4)', 
            border: liveTotalSell > 0 ? '1px solid rgba(248, 113, 113, 0.25)' : '1px solid rgba(255,255,255,0.06)',
            opacity: liveTotalSell > 0 ? 1 : 0.6
          }}>
            <Typography variant="caption" sx={{ color: liveTotalSell > 0 ? '#f87171' : '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              1. Sell Proceeds
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              +{formatCurrency(liveTotalSell)}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              {sellOrders.length} sell orders (step 1)
            </Typography>
          </Box>

          {/* 2. Buy Outlay */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(74, 222, 128, 0.25)' }}>
            <Typography variant="caption" sx={{ color: '#4ade80', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              2. Buy Outlay
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              -{formatCurrency(liveTotalBuy)}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              {buyOrders.length} buy orders (step 2)
            </Typography>
          </Box>

          {/* 3. Net Cash Flow */}
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
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              {liveNetCashImpact >= 0 ? 'Surplus returned to broker' : 'Additional funds required'}
            </Typography>
          </Box>

          {/* 4. Available Cash */}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
              Zerodha Cash Balance
            </Typography>
            <Typography sx={{ color: '#60a5fa', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
              {formatCurrency(availableCash)}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              Uninvested cash funds
            </Typography>
          </Box>

          {/* 5. Margin Adequacy */}
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
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
              {isMarginSufficient ? 'Covered by cash & proceeds' : 'Sell execution will cover'}
            </Typography>
          </Box>

          {/* 6. Estimated Taxes & Fees */}
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
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                ₹0 Brokerage · Hover for detail
              </Typography>
            </Box>
          </Tooltip>
        </Box>

        {/* STEP 2A: SELL ORDERS TABLE */}
        {sellOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(248, 113, 113, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(239, 68, 68, 0.08)', borderBottom: '1px solid rgba(248, 113, 113, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label="STEP 2A" size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#f87171' }}>
                  Sell Orders (CNC Limit) — Executed First to Release Capital
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                {sellOrders.length} orders · +{formatCurrency(liveTotalSell)}
              </Typography>
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <StyledHeaderCell>Stock</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 170 }}>Quantity</StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP (Market)</StyledHeaderCell>
                  <StyledHeaderCell align="right" sx={{ width: 230 }}>Limit Price (₹)</StyledHeaderCell>
                  <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 100 }}>Market Depth</StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sellOrders.map((o) => {
                  const isDepthOpen = expandedDepthSymbol === o.symbol;

                  return (
                    <Box component="tbody" key={o.symbol} sx={{ display: 'contents' }}>
                      <StyledTableRow>
                        {/* Stock */}
                        <StyledCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                            <Chip label="CNC" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                            <Chip label="NSE" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                          </Box>
                        </StyledCell>

                        {/* Quantity Stepper */}
                        <StyledCell align="center">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, -1)}
                              disabled={o.quantity <= 1 || isExecuting}
                              sx={{ color: '#f87171', p: 0.5, bgcolor: 'rgba(239, 68, 68, 0.08)' }}
                            >
                              <FontAwesomeIcon icon={faMinus} size="xs" />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.quantity}
                              onChange={(e) => updateOrderQuantity(o.symbol, parseInt(e.target.value) || 1)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { min: 1, style: { textAlign: 'center', padding: '4px 6px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#f87171', fontWeight: 700 } }
                              }}
                              sx={{ width: 65, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(248, 113, 113, 0.2)' } }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, 1)}
                              disabled={isExecuting}
                              sx={{ color: '#f87171', p: 0.5, bgcolor: 'rgba(239, 68, 68, 0.08)' }}
                            >
                              <FontAwesomeIcon icon={faPlus} size="xs" />
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
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderPrice(o.symbol, -0.05)}
                              disabled={isExecuting}
                              sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                            >
                              <FontAwesomeIcon icon={faMinus} size="xs" />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.price}
                              onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { step: 0.05, style: { textAlign: 'right', padding: '4px 8px', fontSize: '0.8rem', fontFamily: 'monospace' } }
                              }}
                              sx={{ width: 90, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' } }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderPrice(o.symbol, 0.05)}
                              disabled={isExecuting}
                              sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                            >
                              <FontAwesomeIcon icon={faPlus} size="xs" />
                            </IconButton>
                            <Tooltip title="Reset to LTP">
                              <IconButton 
                                size="small" 
                                onClick={() => resetOrderToLtp(o.symbol)}
                                disabled={isExecuting}
                                sx={{ color: '#60a5fa', p: 0.5, fontSize: '0.65rem' }}
                              >
                                LTP
                              </IconButton>
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
                            variant="text"
                            onClick={() => setExpandedDepthSymbol(isDepthOpen ? null : o.symbol)}
                            endIcon={<FontAwesomeIcon icon={isDepthOpen ? faChevronUp : faChevronDown} size="xs" />}
                            sx={{ fontSize: '0.7rem', textTransform: 'none', color: isDepthOpen ? '#60a5fa' : '#9ca3af', px: 1, py: 0.2 }}
                          >
                            Depth
                          </Button>
                        </StyledCell>
                      </StyledTableRow>

                      {/* Collapsible Depth Row */}
                      {isDepthOpen && (
                        <TableRow>
                          <TableCell colSpan={6} sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <Collapse in={isDepthOpen}>
                              <MarketDepthPanel 
                                symbol={o.symbol} 
                                onSelectPrice={(price) => updateOrderPrice(o.symbol, price)} 
                              />
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </Box>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* STEP 2B: BUY ORDERS TABLE */}
        {buyOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(74, 222, 128, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(34, 197, 94, 0.08)', borderBottom: '1px solid rgba(74, 222, 128, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label="STEP 2B" size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80' }}>
                  Buy Orders (CNC Limit) — Funded by Cash & Proceeds
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                {buyOrders.length} orders · -{formatCurrency(liveTotalBuy)}
              </Typography>
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <StyledHeaderCell>Stock</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 170 }}>Quantity</StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP (Market)</StyledHeaderCell>
                  <StyledHeaderCell align="right" sx={{ width: 230 }}>Limit Price (₹)</StyledHeaderCell>
                  <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 100 }}>Market Depth</StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {buyOrders.map((o) => {
                  const isDepthOpen = expandedDepthSymbol === o.symbol;

                  return (
                    <Box component="tbody" key={o.symbol} sx={{ display: 'contents' }}>
                      <StyledTableRow>
                        {/* Stock */}
                        <StyledCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                            <Chip label="CNC" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                            <Chip label="NSE" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                          </Box>
                        </StyledCell>

                        {/* Quantity Stepper */}
                        <StyledCell align="center">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, -1)}
                              disabled={o.quantity <= 1 || isExecuting}
                              sx={{ color: '#4ade80', p: 0.5, bgcolor: 'rgba(74, 222, 128, 0.08)' }}
                            >
                              <FontAwesomeIcon icon={faMinus} size="xs" />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.quantity}
                              onChange={(e) => updateOrderQuantity(o.symbol, parseInt(e.target.value) || 1)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { min: 1, style: { textAlign: 'center', padding: '4px 6px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#4ade80', fontWeight: 700 } }
                              }}
                              sx={{ width: 65, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(74, 222, 128, 0.2)' } }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderQuantity(o.symbol, 1)}
                              disabled={isExecuting}
                              sx={{ color: '#4ade80', p: 0.5, bgcolor: 'rgba(74, 222, 128, 0.08)' }}
                            >
                              <FontAwesomeIcon icon={faPlus} size="xs" />
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
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderPrice(o.symbol, -0.05)}
                              disabled={isExecuting}
                              sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                            >
                              <FontAwesomeIcon icon={faMinus} size="xs" />
                            </IconButton>
                            <TextField
                              size="small"
                              type="number"
                              value={o.price}
                              onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                              disabled={isExecuting}
                              slotProps={{
                                htmlInput: { step: 0.05, style: { textAlign: 'right', padding: '4px 8px', fontSize: '0.8rem', fontFamily: 'monospace' } }
                              }}
                              sx={{ width: 90, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' } }}
                            />
                            <IconButton 
                              size="small" 
                              onClick={() => stepOrderPrice(o.symbol, 0.05)}
                              disabled={isExecuting}
                              sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                            >
                              <FontAwesomeIcon icon={faPlus} size="xs" />
                            </IconButton>
                            <Tooltip title="Reset to LTP">
                              <IconButton 
                                size="small" 
                                onClick={() => resetOrderToLtp(o.symbol)}
                                disabled={isExecuting}
                                sx={{ color: '#60a5fa', p: 0.5, fontSize: '0.65rem' }}
                              >
                                LTP
                              </IconButton>
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
                            variant="text"
                            onClick={() => setExpandedDepthSymbol(isDepthOpen ? null : o.symbol)}
                            endIcon={<FontAwesomeIcon icon={isDepthOpen ? faChevronUp : faChevronDown} size="xs" />}
                            sx={{ fontSize: '0.7rem', textTransform: 'none', color: isDepthOpen ? '#60a5fa' : '#9ca3af', px: 1, py: 0.2 }}
                          >
                            Depth
                          </Button>
                        </StyledCell>
                      </StyledTableRow>

                      {/* Collapsible Depth Row */}
                      {isDepthOpen && (
                        <TableRow>
                          <TableCell colSpan={6} sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <Collapse in={isDepthOpen}>
                              <MarketDepthPanel 
                                symbol={o.symbol} 
                                onSelectPrice={(price) => updateOrderPrice(o.symbol, price)} 
                              />
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </Box>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>

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
            '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.05)' }
          }}
        >
          ← Back to Plan (Step 1)
        </Button>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>
              {orders.length} Orders · Outlay: {formatCurrency(liveTotalBuy)}
            </Typography>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem' }}>
              Proceeds: +{formatCurrency(liveTotalSell)} · Net: {formatCurrency(liveNetCashImpact)}
            </Typography>
          </Box>

          <Button
            variant="contained"
            size="small"
            onClick={() => onProceedToExecute(orders)}
            disabled={orders.length === 0 || isExecuting}
            startIcon={isExecuting ? <CircularProgress size={14} color="inherit" /> : <FontAwesomeIcon icon={faBolt} size="xs" />}
            sx={{
              textTransform: 'none',
              height: 38,
              px: 3,
              fontSize: '0.85rem',
              fontWeight: 700,
              bgcolor: '#2563eb',
              color: '#fff',
              boxShadow: '0 0 15px rgba(37, 99, 235, 0.4)',
              '&:hover': { bgcolor: '#1d4ed8' }
            }}
          >
            Execute (Sells First) →
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
