'use client';

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
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
  faArrowLeft,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { RebalanceOrderItem, RebalancePreflightSummary } from '@/lib/types';
import type { RebalanceAction } from '@/lib/rebalance';
import { getRebalancePreflightAction } from '@/app/actions/zerodha-orders';
import { getTickSize, roundToTick, getNextTickPrice } from '@/lib/tick-utils';
import MarketDepthPanel from './MarketDepthPanel';

const StyledHeaderCell = styled(TableCell)(() => ({
  backgroundColor: '#0f172a',
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: '0.6rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  padding: '5px 6px',
  zIndex: 2,
}));

const StyledCell = styled(TableCell)(() => ({
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  color: '#d1d5db',
  padding: '4px 6px',
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
}));

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

interface OrderRowProps {
  order: RebalanceOrderItem;
  isSell: boolean;
  isDepthOpen: boolean;
  isExecuting: boolean;
  onOpenDepth: (e: React.MouseEvent<HTMLElement>, symbol: string) => void;
  onStepQuantity: (symbol: string, delta: number) => void;
  onUpdateQuantity: (symbol: string, qty: number) => void;
  onStepPrice: (symbol: string, direction: 1 | -1) => void;
  onUpdatePrice: (symbol: string, price: number) => void;
  onResetToLtp: (symbol: string) => void;
  onRemoveOrder: (symbol: string) => void;
}

const OrderRow = memo(function OrderRow({
  order,
  isSell,
  isDepthOpen,
  isExecuting,
  onOpenDepth,
  onStepQuantity,
  onUpdateQuantity,
  onStepPrice,
  onUpdatePrice,
  onResetToLtp,
  onRemoveOrder,
}: OrderRowProps) {
  const accentColor = isSell ? '#f87171' : '#4ade80';
  const borderAccent = isSell ? 'rgba(248, 113, 113, 0.25)' : 'rgba(74, 222, 128, 0.25)';
  const hoverBg = isSell ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)';
  const isLtpModified = Math.abs(order.price - order.currentPrice) > 0.005;
  const tick = getTickSize(order.price);

  return (
    <StyledTableRow>
      {/* Stock Symbol - Compact Width */}
      <StyledCell sx={{ width: 82, maxWidth: 88 }}>
        <Typography 
          title={order.symbol}
          sx={{ 
            fontWeight: 700, 
            color: '#fff', 
            fontSize: '0.72rem', 
            lineHeight: 1.2, 
            whiteSpace: 'nowrap', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis' 
          }}
        >
          {order.symbol}
        </Typography>
      </StyledCell>

      {/* Quantity Stepper */}
      <StyledCell align="center" sx={{ width: 90 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: `1px solid ${borderAccent}`, borderRadius: 1, p: '1px' }}>
          <IconButton 
            size="small" 
            onClick={() => onStepQuantity(order.symbol, -1)}
            disabled={order.quantity <= 1 || isExecuting}
            sx={{ color: accentColor, width: 18, height: 18, borderRadius: 0.75, p: 0, '&:hover': { bgcolor: hoverBg } }}
          >
            <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.5rem' }} />
          </IconButton>
          <TextField
            size="small"
            type="number"
            value={order.quantity}
            onChange={(e) => onUpdateQuantity(order.symbol, parseInt(e.target.value) || 1)}
            disabled={isExecuting}
            slotProps={{
              htmlInput: { 
                min: 1, 
                style: { 
                  textAlign: 'center', 
                  padding: '0px 2px', 
                  fontSize: '0.7rem', 
                  fontFamily: 'monospace', 
                  fontWeight: 700, 
                  width: 38,
                  color: accentColor 
                } 
              }
            }}
            sx={{ 
              ...hideSpinners,
              '& .MuiOutlinedInput-root': {
                height: 20,
                '& fieldset': { border: 'none' },
              }
            }}
          />
          <IconButton 
            size="small" 
            onClick={() => onStepQuantity(order.symbol, 1)}
            disabled={isExecuting}
            sx={{ color: accentColor, width: 18, height: 18, borderRadius: 0.75, p: 0, '&:hover': { bgcolor: hoverBg } }}
          >
            <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.5rem' }} />
          </IconButton>
        </Box>
      </StyledCell>

      {/* LTP */}
      <StyledCell align="right" sx={{ width: 58 }}>
        <Typography sx={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: '0.68rem' }}>
          ₹{formatNumber(order.currentPrice, 2)}
        </Typography>
      </StyledCell>

      {/* Limit Price Stepper */}
      <StyledCell align="right" sx={{ width: 130 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1, p: '1px' }}>
            <IconButton 
              size="small" 
              onClick={() => onStepPrice(order.symbol, -1)}
              disabled={isExecuting}
              sx={{ color: '#9ca3af', width: 18, height: 18, borderRadius: 0.75, p: 0, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
            >
              <FontAwesomeIcon icon={faMinus} style={{ fontSize: '0.5rem' }} />
            </IconButton>
            <TextField
              size="small"
              type="number"
              value={order.price}
              onChange={(e) => onUpdatePrice(order.symbol, parseFloat(e.target.value) || tick)}
              disabled={isExecuting}
              slotProps={{
                htmlInput: { 
                  step: tick, 
                  style: { 
                    textAlign: 'right', 
                    padding: '0px 3px', 
                    fontSize: '0.7rem', 
                    fontFamily: 'monospace', 
                    fontWeight: 600, 
                    width: 52,
                    color: '#fff' 
                  } 
                }
              }}
              sx={{ 
                ...hideSpinners,
                '& .MuiOutlinedInput-root': {
                  height: 20,
                  '& fieldset': { border: 'none' },
                }
              }}
            />
            <IconButton 
              size="small" 
              onClick={() => onStepPrice(order.symbol, 1)}
              disabled={isExecuting}
              sx={{ color: '#9ca3af', width: 18, height: 18, borderRadius: 0.75, p: 0, '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' } }}
            >
              <FontAwesomeIcon icon={faPlus} style={{ fontSize: '0.5rem' }} />
            </IconButton>
          </Box>
          <Tooltip title={isLtpModified ? `Reset to LTP (₹${formatNumber(order.currentPrice, 2)})` : 'Matching LTP'}>
            <span>
              <Button
                size="small"
                variant="text"
                onClick={() => onResetToLtp(order.symbol)}
                disabled={isExecuting || !isLtpModified}
                sx={{ 
                  minWidth: 26, 
                  height: 20, 
                  px: 0.5, 
                  fontSize: '0.58rem', 
                  fontWeight: 700, 
                  color: isLtpModified ? '#60a5fa' : '#64748b', 
                  bgcolor: isLtpModified ? 'rgba(96, 165, 250, 0.15)' : 'rgba(255,255,255,0.02)', 
                  border: `1px solid ${isLtpModified ? 'rgba(96, 165, 250, 0.3)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 0.75,
                  lineHeight: 1,
                  transition: 'all 0.15s ease',
                  '&:hover': { bgcolor: 'rgba(96, 165, 250, 0.25)', color: '#93c5fd' }
                }}
              >
                LTP
              </Button>
            </span>
          </Tooltip>
        </Box>
      </StyledCell>

      {/* Total Value */}
      <StyledCell align="right" sx={{ width: 72 }}>
        <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, color: accentColor, fontSize: '0.7rem' }}>
          {formatCurrency(order.quantity * order.price)}
        </Typography>
      </StyledCell>

      {/* Actions: Depth + Remove */}
      <StyledCell align="center" sx={{ width: 55 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          {/* Depth Trigger */}
          <Tooltip title="Market Depth">
            <IconButton
              size="small"
              onClick={(e) => onOpenDepth(e, order.symbol)}
              sx={{ 
                width: 22, 
                height: 22, 
                p: 0,
                borderRadius: 0.75,
                bgcolor: isDepthOpen ? '#2563eb' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isDepthOpen ? '#3b82f6' : 'rgba(255,255,255,0.08)'}`,
                color: isDepthOpen ? '#fff' : '#9ca3af',
                '&:hover': { bgcolor: isDepthOpen ? '#1d4ed8' : 'rgba(255,255,255,0.08)', color: '#fff' }
              }}
            >
              <FontAwesomeIcon icon={faChartSimple} style={{ fontSize: '0.6rem' }} />
            </IconButton>
          </Tooltip>

          {/* Remove From Plan */}
          <Tooltip title={`Remove ${order.symbol}`}>
            <IconButton
              size="small"
              onClick={() => onRemoveOrder(order.symbol)}
              disabled={isExecuting}
              sx={{ 
                width: 22, 
                height: 22, 
                p: 0,
                borderRadius: 0.75,
                color: '#64748b',
                bgcolor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                '&:hover': { color: '#f87171', bgcolor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(248, 113, 113, 0.25)' }
              }}
            >
              <FontAwesomeIcon icon={faTrash} style={{ fontSize: '0.55rem' }} />
            </IconButton>
          </Tooltip>
        </Box>
      </StyledCell>
    </StyledTableRow>
  );
});

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

  const handleOpenDepth = useCallback((e: React.MouseEvent<HTMLElement>, symbol: string) => {
    if (selectedDepthSymbol === symbol && depthAnchorEl) {
      setDepthAnchorEl(null);
      setSelectedDepthSymbol(null);
    } else {
      setDepthAnchorEl(e.currentTarget);
      setSelectedDepthSymbol(symbol);
    }
  }, [depthAnchorEl, selectedDepthSymbol]);

  const handleCloseDepth = useCallback(() => {
    setDepthAnchorEl(null);
    setSelectedDepthSymbol(null);
  }, []);

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

  // Order modification handlers with stock-price based tick sizes
  const updateOrderPrice = useCallback((symbol: string, newPrice: number) => {
    const tick = getTickSize(newPrice);
    const validPrice = roundToTick(newPrice, tick);

    const next = orders.map(o => o.symbol === symbol ? { ...o, price: validPrice } : o);
    onUpdateOrders(next);
    loadPreflight(next);
  }, [orders, onUpdateOrders, loadPreflight]);

  const stepOrderPrice = useCallback((symbol: string, direction: 1 | -1) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    const nextPrice = getNextTickPrice(o.price, direction);
    updateOrderPrice(symbol, nextPrice);
  }, [orders, updateOrderPrice]);

  const resetOrderToLtp = useCallback((symbol: string) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    updateOrderPrice(symbol, o.currentPrice);
  }, [orders, updateOrderPrice]);

  const updateOrderQuantity = useCallback((symbol: string, newQty: number) => {
    const validQty = Math.max(1, Math.round(newQty));
    const next = orders.map(o => o.symbol === symbol ? { ...o, quantity: validQty } : o);
    onUpdateOrders(next);
    loadPreflight(next);
  }, [orders, onUpdateOrders, loadPreflight]);

  const stepOrderQuantity = useCallback((symbol: string, delta: number) => {
    const o = orders.find(x => x.symbol === symbol);
    if (!o) return;
    updateOrderQuantity(symbol, o.quantity + delta);
  }, [orders, updateOrderQuantity]);

  const removeOrder = useCallback((symbol: string) => {
    const next = orders.filter(o => o.symbol !== symbol);
    onUpdateOrders(next);
    loadPreflight(next);
  }, [orders, onUpdateOrders, loadPreflight]);

  // Optimistic totals computed directly from current orders state
  const sellOrders = useMemo(() => orders.filter(o => o.transactionType === 'SELL'), [orders]);
  const buyOrders = useMemo(() => orders.filter(o => o.transactionType === 'BUY'), [orders]);

  // Sorted alphabetically by symbol
  const sortedSellOrders = useMemo(() => 
    [...sellOrders].sort((a, b) => a.symbol.localeCompare(b.symbol)), 
    [sellOrders]
  );
  const sortedBuyOrders = useMemo(() => 
    [...buyOrders].sort((a, b) => a.symbol.localeCompare(b.symbol)), 
    [buyOrders]
  );

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      
      {/* 1. TOP FINANCIAL SUMMARY RIBBON */}
      <Box sx={{ px: { xs: 2, sm: 2.5 }, pt: 1.25, pb: 0.5, flexShrink: 0 }}>
        {preflightError && (
          <Alert severity="warning" sx={{ mb: 1, py: 0.2, px: 1.5, fontSize: '0.72rem', bgcolor: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            {preflightError}
          </Alert>
        )}

        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, 
          gap: 0.75,
          p: 0.6,
          bgcolor: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 2,
        }}>
          {/* Sell Proceeds */}
          <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: liveTotalSell > 0 ? '1px solid rgba(248, 113, 113, 0.2)' : '1px solid rgba(255,255,255,0.04)' }}>
            <Typography sx={{ color: liveTotalSell > 0 ? '#f87171' : '#9ca3af', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              Sell Proceeds
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '0.82rem', fontWeight: 700, mt: 0.15, fontFamily: 'monospace' }}>
              +{formatCurrency(liveTotalSell)}
            </Typography>
          </Box>

          {/* Buy Outlay */}
          <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
            <Typography sx={{ color: '#4ade80', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              Buy Outlay
            </Typography>
            <Typography sx={{ color: '#fff', fontSize: '0.82rem', fontWeight: 700, mt: 0.15, fontFamily: 'monospace' }}>
              -{formatCurrency(liveTotalBuy)}
            </Typography>
          </Box>

          {/* Net Cash Impact */}
          <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <Typography sx={{ color: '#9ca3af', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              Net Cash Impact
            </Typography>
            <Typography sx={{ color: liveNetCashImpact >= 0 ? '#4ade80' : '#fbbf24', fontSize: '0.82rem', fontWeight: 700, mt: 0.15, fontFamily: 'monospace' }}>
              {liveNetCashImpact >= 0 ? '+' : ''}{formatCurrency(liveNetCashImpact)}
            </Typography>
          </Box>

          {/* Zerodha Cash */}
          <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ color: '#9ca3af', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Zerodha Cash
              </Typography>
              <Tooltip title="Refresh margins">
                <IconButton 
                  size="small" 
                  onClick={() => loadPreflight(orders)} 
                  disabled={isLoadingPreflight || isExecuting}
                  sx={{ p: 0.15, color: '#9ca3af', '&:hover': { color: '#60a5fa' } }}
                >
                  {isLoadingPreflight ? <CircularProgress size={9} color="inherit" /> : <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: '0.52rem' }} />}
                </IconButton>
              </Tooltip>
            </Box>
            <Typography sx={{ color: '#60a5fa', fontSize: '0.82rem', fontWeight: 700, mt: 0.15, fontFamily: 'monospace' }}>
              {formatCurrency(availableCash)}
            </Typography>
          </Box>

          {/* Margin Status */}
          <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <Typography sx={{ color: '#9ca3af', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              Margin Status
            </Typography>
            <Typography sx={{ color: isMarginSufficient ? '#4ade80' : '#fbbf24', fontSize: '0.8rem', fontWeight: 700, mt: 0.15 }}>
              {isMarginSufficient ? 'Sufficient' : `Shortfall: ${formatCurrency(marginShortfall)}`}
            </Typography>
          </Box>

          {/* Est. Taxes & Fees */}
          <Tooltip title={
            <Box sx={{ p: 0.5, fontSize: '0.65rem' }}>
              <div>STT: {formatCurrency(preflight?.charges.stt || 0)}</div>
              <div>Brokerage: ₹0.00 (Zerodha Delivery)</div>
              <div>Exchange Fees: {formatCurrency(preflight?.charges.exchangeTurnover || 0)}</div>
              <div>GST: {formatCurrency(preflight?.charges.gst || 0)}</div>
              <div>Stamp Duty: {formatCurrency(preflight?.charges.stampDuty || 0)}</div>
              <div>SEBI Charges: {formatCurrency(preflight?.charges.sebiCharges || 0)}</div>
            </Box>
          }>
            <Box sx={{ px: 1.2, py: 0.5, borderRadius: 1.25, bgcolor: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
              <Typography sx={{ color: '#9ca3af', fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FontAwesomeIcon icon={faCoins} style={{ fontSize: '0.52rem' }} /> Est. Taxes
              </Typography>
              <Typography sx={{ color: '#cbd5e1', fontSize: '0.82rem', fontWeight: 700, mt: 0.15, fontFamily: 'monospace' }}>
                {formatCurrency(preflight?.charges.totalCharges || 0)}
              </Typography>
            </Box>
          </Tooltip>
        </Box>
      </Box>

      {/* 2. MAIN 2-COLUMN ORDER WORKSPACE */}
      <Box sx={{ 
        flex: 1, 
        minHeight: 0, 
        px: { xs: 2, sm: 2.5 }, 
        py: 1, 
        display: 'grid', 
        gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, 
        gap: 1.5,
        overflow: 'hidden' 
      }}>
        
        {/* COLUMN 1: SELL ORDERS (Sorted A-Z) */}
        <Box sx={{ 
          borderRadius: 2, 
          border: '1px solid rgba(248, 113, 113, 0.2)', 
          bgcolor: 'rgba(15, 23, 42, 0.4)',
          display: 'flex', 
          flexDirection: 'column', 
          minHeight: 0,
          height: '100%',
          overflow: 'hidden'
        }}>
          {/* Sell Header */}
          <Box sx={{ 
            px: 1.5, 
            py: 0.75, 
            bgcolor: 'rgba(239, 68, 68, 0.08)', 
            borderBottom: '1px solid rgba(248, 113, 113, 0.15)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1,
            flexShrink: 0
          }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#f87171' }}>
              Sell Orders
            </Typography>
            <Chip 
              label={sortedSellOrders.length} 
              size="small" 
              sx={{ 
                height: 16, 
                fontSize: '0.62rem', 
                fontWeight: 700, 
                bgcolor: 'rgba(239, 68, 68, 0.15)', 
                color: '#f87171',
                border: '1px solid rgba(248, 113, 113, 0.25)',
              }} 
            />
          </Box>

          {/* Sell Table Scroll Area */}
          <Box sx={{ 
            flex: 1, 
            minHeight: 0, 
            overflowY: 'auto', 
            overflowX: 'auto', 
            '&::-webkit-scrollbar': { width: 5, height: 5 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 2.5 },
            '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
          }}>
            {sortedSellOrders.length === 0 ? (
              <Box sx={{ height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, color: '#64748b' }}>
                <Typography variant="caption" sx={{ fontSize: '0.72rem' }}>No sell orders required</Typography>
              </Box>
            ) : (
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <StyledHeaderCell sx={{ width: 82 }}>Stock</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 90 }}>Qty</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 58 }}>LTP</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 130 }}>Limit Price</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 72 }}>Value</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 55 }}>Actions</StyledHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedSellOrders.map((o) => (
                    <OrderRow
                      key={o.symbol}
                      order={o}
                      isSell={true}
                      isDepthOpen={selectedDepthSymbol === o.symbol && Boolean(depthAnchorEl)}
                      isExecuting={isExecuting}
                      onOpenDepth={handleOpenDepth}
                      onStepQuantity={stepOrderQuantity}
                      onUpdateQuantity={updateOrderQuantity}
                      onStepPrice={stepOrderPrice}
                      onUpdatePrice={updateOrderPrice}
                      onResetToLtp={resetOrderToLtp}
                      onRemoveOrder={removeOrder}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Box>

        {/* COLUMN 2: BUY ORDERS (Sorted A-Z) */}
        <Box sx={{ 
          borderRadius: 2, 
          border: '1px solid rgba(74, 222, 128, 0.2)', 
          bgcolor: 'rgba(15, 23, 42, 0.4)',
          display: 'flex', 
          flexDirection: 'column', 
          minHeight: 0,
          height: '100%',
          overflow: 'hidden'
        }}>
          {/* Buy Header */}
          <Box sx={{ 
            px: 1.5, 
            py: 0.75, 
            bgcolor: 'rgba(34, 197, 94, 0.08)', 
            borderBottom: '1px solid rgba(74, 222, 128, 0.15)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1,
            flexShrink: 0
          }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80' }}>
              Buy Orders
            </Typography>
            <Chip 
              label={sortedBuyOrders.length} 
              size="small" 
              sx={{ 
                height: 16, 
                fontSize: '0.62rem', 
                fontWeight: 700, 
                bgcolor: 'rgba(34, 197, 94, 0.15)', 
                color: '#4ade80',
                border: '1px solid rgba(74, 222, 128, 0.25)',
              }} 
            />
          </Box>

          {/* Buy Table Scroll Area */}
          <Box sx={{ 
            flex: 1, 
            minHeight: 0, 
            overflowY: 'auto', 
            overflowX: 'auto', 
            '&::-webkit-scrollbar': { width: 5, height: 5 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 2.5 },
            '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
          }}>
            {sortedBuyOrders.length === 0 ? (
              <Box sx={{ height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, color: '#64748b' }}>
                <Typography variant="caption" sx={{ fontSize: '0.72rem' }}>No buy orders required</Typography>
              </Box>
            ) : (
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <StyledHeaderCell sx={{ width: 82 }}>Stock</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 90 }}>Qty</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 58 }}>LTP</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 130 }}>Limit Price</StyledHeaderCell>
                    <StyledHeaderCell align="right" sx={{ width: 72 }}>Value</StyledHeaderCell>
                    <StyledHeaderCell align="center" sx={{ width: 55 }}>Actions</StyledHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedBuyOrders.map((o) => (
                    <OrderRow
                      key={o.symbol}
                      order={o}
                      isSell={false}
                      isDepthOpen={selectedDepthSymbol === o.symbol && Boolean(depthAnchorEl)}
                      isExecuting={isExecuting}
                      onOpenDepth={handleOpenDepth}
                      onStepQuantity={stepOrderQuantity}
                      onUpdateQuantity={updateOrderQuantity}
                      onStepPrice={stepOrderPrice}
                      onUpdatePrice={updateOrderPrice}
                      onResetToLtp={resetOrderToLtp}
                      onRemoveOrder={removeOrder}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Box>

      </Box>

      {/* 3. MARKET DEPTH POPOVER OVERLAY */}
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

      {/* 4. FOOTER NAVIGATION BAR */}
      <Box sx={{ 
        px: { xs: 2, sm: 2.5 }, 
        py: 0.8, 
        borderTop: '1px solid rgba(255,255,255,0.08)', 
        bgcolor: 'rgba(15, 23, 42, 0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5,
        flexShrink: 0
      }}>
        <Button
          variant="outlined"
          size="small"
          onClick={onBackToPlan}
          startIcon={<FontAwesomeIcon icon={faArrowLeft} size="xs" />}
          sx={{
            textTransform: 'none',
            height: 30,
            fontSize: '0.72rem',
            borderColor: 'rgba(255,255,255,0.15)',
            color: '#d1d5db',
            borderRadius: 1.25,
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
            startIcon={isExecuting ? <CircularProgress size={12} color="inherit" /> : <FontAwesomeIcon icon={faBolt} size="xs" />}
            sx={{
              textTransform: 'none',
              height: 32,
              px: 2.5,
              fontSize: '0.78rem',
              fontWeight: 700,
              letterSpacing: '0.01em',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
              borderRadius: 1.25,
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
