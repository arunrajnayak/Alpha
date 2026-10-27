'use client';

import { useState, useEffect, useMemo, useCallback, forwardRef } from 'react';
import Dialog from '@mui/material/Dialog';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faXmark, 
  faRotateRight, 
  faTriangleExclamation, 
  faCheck,
  faBolt,
  faArrowUpRightFromSquare,
  faCircleCheck,
  faCircleXmark,
  faCoins,
  faPlus,
  faMinus,
  faShieldHalved
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { 
  RebalanceOrderItem, 
  RebalancePreflightSummary, 
  OrderLiveStatus 
} from '@/lib/types';
import type { RebalanceAction } from '@/lib/rebalance';
import { 
  getRebalancePreflightAction, 
  executeRebalanceBatchAction, 
  executeSingleOrderAction, 
  getKitePublisherBasketAction,
  checkRebalanceOrdersStatusAction 
} from '@/app/actions/zerodha-orders';

const Transition = forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

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

interface RebalanceExecutionModalProps {
  open: boolean;
  onClose: () => void;
  actions: RebalanceAction[];
  priceMap?: Record<string, number>;
  availableCash?: number;
}

export default function RebalanceExecutionModal({
  open,
  onClose,
  actions,
  priceMap,
}: RebalanceExecutionModalProps) {
  const [orders, setOrders] = useState<RebalanceOrderItem[]>([]);
  const [preflight, setPreflight] = useState<RebalancePreflightSummary | null>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executingOrderSymbol, setExecutingOrderSymbol] = useState<string | null>(null);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);

  const [orderStatusMap, setOrderStatusMap] = useState<Record<string, OrderLiveStatus>>({});
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // Initialize and fetch pre-flight data
  const loadPreflight = useCallback(async (currentOrdersList?: RebalanceOrderItem[]) => {
    setIsLoadingPreflight(true);
    setPreflightError(null);
    try {
      const input = currentOrdersList && currentOrdersList.length > 0 ? currentOrdersList : actions;
      const res = await getRebalancePreflightAction(input, priceMap);
      if (res.success) {
        setPreflight(res.data);
        if (!currentOrdersList || currentOrdersList.length === 0) {
          setOrders(res.data.orders);
        }
      } else {
        setPreflightError(res.error);
      }
    } catch (err) {
      setPreflightError(err instanceof Error ? err.message : 'Failed to fetch preflight data');
    } finally {
      setIsLoadingPreflight(false);
    }
  }, [actions, priceMap]);

  useEffect(() => {
    if (open && actions.length > 0) {
      const timer = setTimeout(() => {
        setOrders([]);
        setOrderStatusMap({});
        setExecutionMessage(null);
        loadPreflight();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, actions, loadPreflight]);

  // Price modification handlers
  const updateOrderPrice = (symbol: string, newPrice: number) => {
    const validPrice = Math.max(0.05, Math.round(newPrice / 0.05) * 0.05);
    const fixedPrice = Number(validPrice.toFixed(2));

    setOrders(prev => {
      const next = prev.map(o => o.symbol === symbol ? { ...o, price: fixedPrice } : o);
      // Recalculate pre-flight in background with updated orders
      loadPreflight(next);
      return next;
    });
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

  // Split into Sells and Buys
  const sellOrders = useMemo(() => orders.filter(o => o.transactionType === 'SELL'), [orders]);
  const buyOrders = useMemo(() => orders.filter(o => o.transactionType === 'BUY'), [orders]);

  // Counts & status helpers
  const placedCount = useMemo(() => orders.filter(o => o.status === 'placed').length, [orders]);
  const failedOrders = useMemo(() => orders.filter(o => o.status === 'failed'), [orders]);
  const pendingOrders = useMemo(() => orders.filter(o => o.status !== 'placed'), [orders]);
  const isAllPlaced = orders.length > 0 && placedCount === orders.length;

  // 1. Direct Execution: Batch execution (Sells first, then Buys)
  const handleExecuteBatch = async (ordersToRun?: RebalanceOrderItem[]) => {
    const targetOrders = ordersToRun || pendingOrders;
    if (targetOrders.length === 0) return;

    setIsExecuting(true);
    setExecutionMessage('Placing SELL orders first to release margin...');

    // Mark targets as submitting
    setOrders(prev => prev.map(o => {
      const isTarget = targetOrders.some(t => t.symbol === o.symbol);
      return isTarget ? { ...o, status: 'submitting', error: undefined } : o;
    }));

    try {
      const res = await executeRebalanceBatchAction(targetOrders);
      if (res.success) {
        const resultMap = new Map(res.data.map(r => [r.symbol, r]));
        let anyFailed = false;

        setOrders(prev => prev.map(o => {
          const r = resultMap.get(o.symbol);
          if (!r) return o;
          if (r.success) {
            return { ...o, status: 'placed', orderId: r.orderId, error: undefined };
          } else {
            anyFailed = true;
            return { ...o, status: 'failed', error: r.error };
          }
        }));

        if (anyFailed) {
          setExecutionMessage('Some orders failed. Review the failure reasons below and use Retry.');
        } else {
          setExecutionMessage('All orders placed successfully as CNC Limit orders!');
        }
      } else {
        setExecutionMessage(`Execution failed: ${res.error}`);
        setOrders(prev => prev.map(o => o.status === 'submitting' ? { ...o, status: 'failed', error: res.error } : o));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution error';
      setExecutionMessage(msg);
      setOrders(prev => prev.map(o => o.status === 'submitting' ? { ...o, status: 'failed', error: msg } : o));
    } finally {
      setIsExecuting(false);
      setExecutingOrderSymbol(null);
    }
  };

  // 2. Row-Level Retry
  const handleRetrySingle = async (order: RebalanceOrderItem) => {
    setExecutingOrderSymbol(order.symbol);
    setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'submitting', error: undefined } : o));

    try {
      const res = await executeSingleOrderAction(order);
      if (res.success && res.data.success) {
        setOrders(prev => prev.map(o => o.symbol === order.symbol ? { 
          ...o, 
          status: 'placed', 
          orderId: res.data.orderId, 
          error: undefined 
        } : o));
      } else {
        const err = (res.success && !res.data.success ? res.data.error : !res.success ? res.error : 'Order failed') || 'Order failed';
        setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'failed', error: err } : o));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to place order';
      setOrders(prev => prev.map(o => o.symbol === order.symbol ? { ...o, status: 'failed', error: msg } : o));
    } finally {
      setExecutingOrderSymbol(null);
    }
  };

  // 3. Open Kite Publisher Basket
  const handleOpenKiteBasket = async () => {
    try {
      const res = await getKitePublisherBasketAction(orders);
      if (!res.success) {
        alert(res.error);
        return;
      }

      // Create a hidden form and submit to Kite Publisher
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = res.data.actionUrl;
      form.target = '_blank';

      const apiKeyInput = document.createElement('input');
      apiKeyInput.type = 'hidden';
      apiKeyInput.name = 'api_key';
      apiKeyInput.value = res.data.apiKey;
      form.appendChild(apiKeyInput);

      const dataInput = document.createElement('input');
      dataInput.type = 'hidden';
      dataInput.name = 'data';
      dataInput.value = res.data.dataJson;
      form.appendChild(dataInput);

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to open Kite Basket');
    }
  };

  // 4. Live Status Checker
  const handleCheckLiveStatus = async () => {
    const placedOrderIds = orders.filter(o => o.orderId).map(o => o.orderId!);
    if (placedOrderIds.length === 0) return;

    setIsCheckingStatus(true);
    try {
      const res = await checkRebalanceOrdersStatusAction(placedOrderIds);
      if (res.success) {
        setOrderStatusMap(res.data);
      }
    } catch (err) {
      console.error('Failed to check live order status:', err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      slots={{ transition: Transition }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: '#0b0f19',
            color: '#fff',
            backgroundImage: 'radial-gradient(ellipse at top, rgba(30, 41, 59, 0.5) 0%, rgba(11, 15, 25, 0.95) 70%)'
          }
        }
      }}
    >
      {/* Header */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: { xs: 2, sm: 3 },
        py: 1.5,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        bgcolor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(10px)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ 
            width: 36, 
            height: 36, 
            borderRadius: 2, 
            bgcolor: 'rgba(59, 130, 246, 0.1)', 
            border: '1px solid rgba(59, 130, 246, 0.2)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#60a5fa'
          }}>
            <FontAwesomeIcon icon={faBolt} />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 700, color: '#f3f4f6' }}>
                Rebalance Execution (Zerodha Kite)
              </Typography>
              <Chip
                size="small"
                icon={<FontAwesomeIcon icon={faShieldHalved} size="xs" style={{ color: 'inherit' }} />}
                label="Strictly CNC Limit Only"
                sx={{
                  height: 22,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}
              />
              {preflight?.hasActiveSession ? (
                <Chip
                  size="small"
                  icon={<FontAwesomeIcon icon={faCheck} size="xs" style={{ color: 'inherit' }} />}
                  label="Session Active"
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
            </Box>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Sequencing: SELL orders placed first to release capital → BUY orders placed second
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
              height: 32,
              '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.03)' }
            }}
          >
            Refresh Margins
          </Button>
          <IconButton 
            onClick={onClose} 
            size="small"
            sx={{ 
              color: '#9ca3af',
              bgcolor: 'rgba(255,255,255,0.05)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', color: '#fff' }
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </IconButton>
        </Box>
      </Box>

      {/* Main Container */}
      <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {preflightError && (
          <Alert severity="warning" sx={{ bgcolor: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            {preflightError}
          </Alert>
        )}

        {executionMessage && (
          <Alert 
            severity={failedOrders.length > 0 ? "error" : "success"}
            sx={{ 
              bgcolor: failedOrders.length > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', 
              color: failedOrders.length > 0 ? '#f87171' : '#4ade80', 
              border: `1px solid ${failedOrders.length > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)'}` 
            }}
          >
            {executionMessage}
          </Alert>
        )}

        {/* Financial Summary Dashboard */}
        {preflight && (
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, 
            gap: 1.5 
          }}>
            {/* 1. Sell Proceeds */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
              <Typography variant="caption" sx={{ color: '#f87171', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                1. Sell Proceeds
              </Typography>
              <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                +{formatCurrency(preflight.totalSellValue)}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {sellOrders.length} sell orders (step 1)
              </Typography>
            </Box>

            {/* 2. Buy Commitment */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
              <Typography variant="caption" sx={{ color: '#4ade80', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                2. Buy Outlay
              </Typography>
              <Typography sx={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                -{formatCurrency(preflight.totalBuyValue)}
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
                color: preflight.netCashImpact >= 0 ? '#4ade80' : '#fbbf24', 
                fontSize: '1.1rem', 
                fontWeight: 700, 
                mt: 0.5 
              }}>
                {preflight.netCashImpact >= 0 ? '+' : ''}{formatCurrency(preflight.netCashImpact)}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {preflight.netCashImpact >= 0 ? 'Surplus returned to broker' : 'Additional funds required'}
              </Typography>
            </Box>

            {/* 4. Available Cash */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                Zerodha Cash Balance
              </Typography>
              <Typography sx={{ color: '#60a5fa', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                {formatCurrency(preflight.availableCash)}
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
                color: preflight.isMarginSufficient ? '#4ade80' : '#fbbf24', 
                fontSize: '1.1rem', 
                fontWeight: 700, 
                mt: 0.5 
              }}>
                {preflight.isMarginSufficient ? 'Sufficient' : `Shortfall: ${formatCurrency(preflight.marginShortfall)}`}
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                {preflight.isMarginSufficient ? 'Covered by cash' : 'Sell execution will cover'}
              </Typography>
            </Box>

            {/* 6. Estimated Taxes & Fees */}
            <Tooltip title={
              <Box sx={{ p: 0.5, fontSize: '0.7rem' }}>
                <div>STT: {formatCurrency(preflight.charges.stt)}</div>
                <div>Brokerage: ₹0.00 (Zerodha Delivery)</div>
                <div>Exchange Fees: {formatCurrency(preflight.charges.exchangeTurnover)}</div>
                <div>GST: {formatCurrency(preflight.charges.gst)}</div>
                <div>Stamp Duty: {formatCurrency(preflight.charges.stampDuty)}</div>
                <div>SEBI Charges: {formatCurrency(preflight.charges.sebiCharges)}</div>
              </Box>
            }>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FontAwesomeIcon icon={faCoins} size="xs" /> Est. Taxes & Fees
                </Typography>
                <Typography sx={{ color: '#cbd5e1', fontSize: '1.1rem', fontWeight: 700, mt: 0.5 }}>
                  {formatCurrency(preflight.charges.totalCharges)}
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.7rem' }}>
                  ₹0 Brokerage · Hover for detail
                </Typography>
              </Box>
            </Tooltip>
          </Box>
        )}

        {/* SECTION 1: SELL ORDERS */}
        {sellOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(248, 113, 113, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(239, 68, 68, 0.08)', borderBottom: '1px solid rgba(248, 113, 113, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label="STEP 1" size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#f87171' }}>
                  Sell Orders (CNC Limit) — Executed First to Free Up Margin
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                {sellOrders.length} orders
              </Typography>
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <StyledHeaderCell>Stock</StyledHeaderCell>
                  <StyledHeaderCell align="right">Qty</StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP (Market)</StyledHeaderCell>
                  <StyledHeaderCell align="right" sx={{ width: 220 }}>Limit Price (₹)</StyledHeaderCell>
                  <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 180 }}>Status</StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sellOrders.map((o) => {
                  const live = o.orderId ? orderStatusMap[o.orderId] : undefined;
                  const isRowSubmitting = o.status === 'submitting' || executingOrderSymbol === o.symbol;

                  return (
                    <StyledTableRow key={o.symbol}>
                      {/* Stock */}
                      <StyledCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                          <Chip label="CNC" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                          <Chip label="NSE" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                        </Box>
                      </StyledCell>

                      {/* Qty */}
                      <StyledCell align="right">
                        <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#f87171' }}>
                          -{formatNumber(o.quantity)}
                        </Typography>
                      </StyledCell>

                      {/* LTP */}
                      <StyledCell align="right">
                        <Typography sx={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: '0.8rem' }}>
                          {formatCurrency(o.currentPrice)}
                        </Typography>
                      </StyledCell>

                      {/* Limit Price Editor */}
                      <StyledCell align="right">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                          <IconButton 
                            size="small" 
                            onClick={() => stepOrderPrice(o.symbol, -0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                          >
                            <FontAwesomeIcon icon={faMinus} size="xs" />
                          </IconButton>
                          <TextField
                            size="small"
                            type="number"
                            value={o.price}
                            onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            slotProps={{
                              htmlInput: { step: 0.05, style: { textAlign: 'right', padding: '4px 8px', fontSize: '0.8rem', fontFamily: 'monospace' } }
                            }}
                            sx={{ width: 95, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' } }}
                          />
                          <IconButton 
                            size="small" 
                            onClick={() => stepOrderPrice(o.symbol, 0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                          >
                            <FontAwesomeIcon icon={faPlus} size="xs" />
                          </IconButton>
                          <Tooltip title="Reset to LTP">
                            <IconButton 
                              size="small" 
                              onClick={() => resetOrderToLtp(o.symbol)}
                              disabled={isExecuting || o.status === 'placed'}
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

                      {/* Status */}
                      <StyledCell align="center">
                        {isRowSubmitting ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <CircularProgress size={14} color="inherit" />
                            <Typography variant="caption" sx={{ color: '#60a5fa' }}>Placing...</Typography>
                          </Box>
                        ) : o.status === 'placed' ? (
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.2 }}>
                            <Chip 
                              icon={<FontAwesomeIcon icon={faCircleCheck} size="xs" />}
                              label={live ? `${live.status}` : 'Placed'} 
                              size="small" 
                              sx={{ 
                                height: 20, 
                                fontSize: '0.65rem', 
                                bgcolor: live?.status === 'COMPLETE' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)', 
                                color: live?.status === 'COMPLETE' ? '#4ade80' : '#38bdf8',
                                fontWeight: 700 
                              }} 
                            />
                            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                              #{o.orderId}
                            </Typography>
                          </Box>
                        ) : o.status === 'failed' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <Tooltip title={o.error || 'Order rejected by broker'}>
                              <Chip 
                                icon={<FontAwesomeIcon icon={faCircleXmark} size="xs" />}
                                label="Failed" 
                                size="small" 
                                sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', fontWeight: 700 }} 
                              />
                            </Tooltip>
                            <Button 
                              size="small" 
                              variant="outlined" 
                              onClick={() => handleRetrySingle(o)}
                              disabled={isExecuting}
                              sx={{ height: 22, fontSize: '0.65rem', textTransform: 'none', px: 1, borderColor: 'rgba(248, 113, 113, 0.3)', color: '#f87171' }}
                            >
                              Retry
                            </Button>
                          </Box>
                        ) : (
                          <Typography variant="caption" sx={{ color: '#64748b' }}>Ready</Typography>
                        )}
                      </StyledCell>
                    </StyledTableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* SECTION 2: BUY ORDERS */}
        {buyOrders.length > 0 && (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(74, 222, 128, 0.2)', bgcolor: 'rgba(15, 23, 42, 0.4)' }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: 'rgba(34, 197, 94, 0.08)', borderBottom: '1px solid rgba(74, 222, 128, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label="STEP 2" size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80' }}>
                  Buy Orders (CNC Limit) — Funded by Cash & Proceeds
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                {buyOrders.length} orders
              </Typography>
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <StyledHeaderCell>Stock</StyledHeaderCell>
                  <StyledHeaderCell align="right">Qty</StyledHeaderCell>
                  <StyledHeaderCell align="right">LTP (Market)</StyledHeaderCell>
                  <StyledHeaderCell align="right" sx={{ width: 220 }}>Limit Price (₹)</StyledHeaderCell>
                  <StyledHeaderCell align="right">Total Value</StyledHeaderCell>
                  <StyledHeaderCell align="center" sx={{ width: 180 }}>Status</StyledHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {buyOrders.map((o) => {
                  const live = o.orderId ? orderStatusMap[o.orderId] : undefined;
                  const isRowSubmitting = o.status === 'submitting' || executingOrderSymbol === o.symbol;

                  return (
                    <StyledTableRow key={o.symbol}>
                      {/* Stock */}
                      <StyledCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>{o.symbol}</Typography>
                          <Chip label="CNC" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                          <Chip label="NSE" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.05)', color: '#9ca3af' }} />
                        </Box>
                      </StyledCell>

                      {/* Qty */}
                      <StyledCell align="right">
                        <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#4ade80' }}>
                          +{formatNumber(o.quantity)}
                        </Typography>
                      </StyledCell>

                      {/* LTP */}
                      <StyledCell align="right">
                        <Typography sx={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: '0.8rem' }}>
                          {formatCurrency(o.currentPrice)}
                        </Typography>
                      </StyledCell>

                      {/* Limit Price Editor */}
                      <StyledCell align="right">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                          <IconButton 
                            size="small" 
                            onClick={() => stepOrderPrice(o.symbol, -0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                          >
                            <FontAwesomeIcon icon={faMinus} size="xs" />
                          </IconButton>
                          <TextField
                            size="small"
                            type="number"
                            value={o.price}
                            onChange={(e) => updateOrderPrice(o.symbol, parseFloat(e.target.value) || 0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            slotProps={{
                              htmlInput: { step: 0.05, style: { textAlign: 'right', padding: '4px 8px', fontSize: '0.8rem', fontFamily: 'monospace' } }
                            }}
                            sx={{ width: 95, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' } }}
                          />
                          <IconButton 
                            size="small" 
                            onClick={() => stepOrderPrice(o.symbol, 0.05)}
                            disabled={isExecuting || o.status === 'placed'}
                            sx={{ color: '#9ca3af', p: 0.5, bgcolor: 'rgba(255,255,255,0.05)' }}
                          >
                            <FontAwesomeIcon icon={faPlus} size="xs" />
                          </IconButton>
                          <Tooltip title="Reset to LTP">
                            <IconButton 
                              size="small" 
                              onClick={() => resetOrderToLtp(o.symbol)}
                              disabled={isExecuting || o.status === 'placed'}
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

                      {/* Status */}
                      <StyledCell align="center">
                        {isRowSubmitting ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <CircularProgress size={14} color="inherit" />
                            <Typography variant="caption" sx={{ color: '#60a5fa' }}>Placing...</Typography>
                          </Box>
                        ) : o.status === 'placed' ? (
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.2 }}>
                            <Chip 
                              icon={<FontAwesomeIcon icon={faCircleCheck} size="xs" />}
                              label={live ? `${live.status}` : 'Placed'} 
                              size="small" 
                              sx={{ 
                                height: 20, 
                                fontSize: '0.65rem', 
                                bgcolor: live?.status === 'COMPLETE' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)', 
                                color: live?.status === 'COMPLETE' ? '#4ade80' : '#38bdf8',
                                fontWeight: 700 
                              }} 
                            />
                            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                              #{o.orderId}
                            </Typography>
                          </Box>
                        ) : o.status === 'failed' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <Tooltip title={o.error || 'Order rejected by broker'}>
                              <Chip 
                                icon={<FontAwesomeIcon icon={faCircleXmark} size="xs" />}
                                label="Failed" 
                                size="small" 
                                sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', fontWeight: 700 }} 
                              />
                            </Tooltip>
                            <Button 
                              size="small" 
                              variant="outlined" 
                              onClick={() => handleRetrySingle(o)}
                              disabled={isExecuting}
                              sx={{ height: 22, fontSize: '0.65rem', textTransform: 'none', px: 1, borderColor: 'rgba(248, 113, 113, 0.3)', color: '#f87171' }}
                            >
                              Retry
                            </Button>
                          </Box>
                        ) : (
                          <Typography variant="caption" sx={{ color: '#64748b' }}>Ready</Typography>
                        )}
                      </StyledCell>
                    </StyledTableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>

      {/* Bottom Footer Actions */}
      <Box sx={{
        px: { xs: 2, sm: 3 },
        py: 1.5,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        bgcolor: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="body2" sx={{ color: '#9ca3af', fontSize: '0.8rem' }}>
            Placed: <span style={{ color: '#fff', fontWeight: 700 }}>{placedCount}</span> of {orders.length}
          </Typography>
          {failedOrders.length > 0 && (
            <Chip 
              label={`${failedOrders.length} failed`} 
              size="small" 
              sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', fontWeight: 700 }} 
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* Check Order Status */}
          {placedCount > 0 && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleCheckLiveStatus}
              disabled={isCheckingStatus}
              startIcon={isCheckingStatus ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} size="xs" />}
              sx={{
                textTransform: 'none',
                height: 38,
                fontSize: '0.8rem',
                borderColor: 'rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                '&:hover': { borderColor: 'rgba(56, 189, 248, 0.6)', bgcolor: 'rgba(56, 189, 248, 0.05)' }
              }}
            >
              Check Live Status
            </Button>
          )}

          {/* Open Kite Basket (Kite Publisher) */}
          <Button
            variant="outlined"
            size="small"
            onClick={handleOpenKiteBasket}
            startIcon={<FontAwesomeIcon icon={faArrowUpRightFromSquare} size="xs" />}
            sx={{
              textTransform: 'none',
              height: 38,
              fontSize: '0.8rem',
              borderColor: 'rgba(255,255,255,0.15)',
              color: '#d1d5db',
              '&:hover': { borderColor: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.05)' }
            }}
          >
            Open in Kite Web (Basket)
          </Button>

          {/* Retry Failed Orders */}
          {failedOrders.length > 0 && (
            <Button
              variant="contained"
              size="small"
              onClick={() => handleExecuteBatch(failedOrders)}
              disabled={isExecuting}
              startIcon={<FontAwesomeIcon icon={faRotateRight} size="xs" />}
              sx={{
                textTransform: 'none',
                height: 38,
                fontSize: '0.8rem',
                bgcolor: '#ef4444',
                color: '#fff',
                '&:hover': { bgcolor: '#dc2626' }
              }}
            >
              Retry Failed ({failedOrders.length})
            </Button>
          )}

          {/* Execute All Orders (Sells First) */}
          <Button
            variant="contained"
            size="small"
            onClick={() => handleExecuteBatch()}
            disabled={isExecuting || isAllPlaced || orders.length === 0}
            startIcon={isExecuting ? <CircularProgress size={14} color="inherit" /> : <FontAwesomeIcon icon={faBolt} size="xs" />}
            sx={{
              textTransform: 'none',
              height: 38,
              px: 3,
              fontSize: '0.85rem',
              fontWeight: 700,
              bgcolor: isAllPlaced ? 'rgba(34, 197, 94, 0.2)' : '#2563eb',
              color: isAllPlaced ? '#4ade80' : '#fff',
              '&:hover': { bgcolor: '#1d4ed8' }
            }}
          >
            {isAllPlaced ? 'All Orders Placed' : isExecuting ? 'Executing...' : 'Execute in Zerodha (Sells First)'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
